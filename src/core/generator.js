const fs = require('fs');
const path = require('path');
const { analyzeFile, structuralHash } = require('./analyzer');
const { smartDiff, getContextPath } = require('./smart-diff');
const { callLLM } = require('../llm/provider');
const { SYSTEM_PROMPT, buildUserPrompt } = require('../llm/prompts');

/**
 * Generate or update a .context.md file for a single source file.
 *
 * @param {string} filePath - Absolute path to the source file
 * @param {object} config - Loaded config
 * @param {object} options
 * @param {string} options.developerInput - Developer's explanation (optional)
 * @param {boolean} options.force - Force regeneration even if no structural changes
 * @param {boolean} options.dryRun - Don't write files or call LLM
 * @returns {object} Result with action taken and any warnings
 */
async function generateContext(filePath, config, options = {}) {
  const { developerInput = null, force = false, dryRun = false } = options;

  // Analyze the file
  const analysis = analyzeFile(filePath);
  if (analysis.error) {
    return {
      file: filePath,
      action: 'error',
      message: analysis.error,
    };
  }

  // Smart diff check (unless force)
  const contextPath = getContextPath(filePath, config);
  let diff = { action: 'generate', contextPath };

  if (!force && config.smartDiff) {
    diff = smartDiff(analysis, config);

    if (diff.action === 'no-change') {
      return {
        file: filePath,
        action: 'no-change',
        message: diff.reason,
        contextPath,
      };
    }
  }

  if (dryRun) {
    return {
      file: filePath,
      action: diff.action === 'generate' ? 'would-generate' : 'would-update',
      message: diff.reason || 'Dry run - no LLM call made',
      contextPath,
      changes: diff.changes || [],
      analysis: {
        type: analysis.type,
        exports: analysis.exports.length,
        props: analysis.props.length,
        hooks: analysis.hooks.length,
      },
    };
  }

  // Read source code
  const sourceCode = fs.readFileSync(filePath, 'utf-8');

  // Read existing context if updating
  let existingContext = null;
  if (diff.action === 'update' && fs.existsSync(contextPath)) {
    existingContext = fs.readFileSync(contextPath, 'utf-8');
  }

  // Compute hash
  const hash = structuralHash(analysis);

  // Build prompt
  const userPrompt = buildUserPrompt({
    analysis,
    sourceCode,
    developerInput,
    existingContext,
    hash,
  });

  // Call LLM
  let contextContent;
  try {
    contextContent = await callLLM(config, SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    return {
      file: filePath,
      action: 'error',
      message: `LLM call failed: ${err.message}`,
      contextPath,
    };
  }

  // Clean up response - remove any markdown fencing the LLM might add around the whole response
  contextContent = cleanLLMResponse(contextContent);

  // Verify intent if developer provided input
  let intentWarning = null;
  if (developerInput) {
    intentWarning = extractIntentWarning(contextContent);
  }

  // Write the file
  ensureDir(path.dirname(contextPath));
  fs.writeFileSync(contextPath, contextContent, 'utf-8');

  return {
    file: filePath,
    action: diff.action === 'generate' ? 'generated' : 'updated',
    contextPath,
    intentWarning,
    changes: diff.changes || [],
  };
}

/**
 * Process multiple files with concurrency control.
 */
async function generateBatch(files, config, options = {}) {
  const { concurrency = config.concurrency || 5 } = options;
  const results = [];
  const queue = [...files];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;
      const result = await generateContext(file, config, options);
      results.push(result);
    }
  }

  // Run workers in parallel
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}

/**
 * Clean up LLM response - remove outer markdown fencing if present.
 */
function cleanLLMResponse(content) {
  // Remove ```markdown ... ``` wrapping if the LLM added it
  let cleaned = content.trim();
  if (cleaned.startsWith('```markdown')) {
    cleaned = cleaned.slice('```markdown'.length);
  } else if (cleaned.startsWith('```md')) {
    cleaned = cleaned.slice('```md'.length);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }

  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim() + '\n';
}

/**
 * Check if the LLM flagged an intent mismatch.
 */
function extractIntentWarning(content) {
  const match = content.match(/INTENT MISMATCH[:\s]*([^\n]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Ensure a directory exists.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

module.exports = {
  generateContext,
  generateBatch,
};
