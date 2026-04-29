const fs = require('fs');
const path = require('path');
const { analyzeFile, structuralHash } = require('./analyzer');
const { smartDiff, getContextPath } = require('./smart-diff');
const { callLLM } = require('../llm/provider');
const { SYSTEM_PROMPT, buildUserPrompt } = require('../llm/prompts');
const { version } = require('../../package.json');

const debug = (...args) => {
  if (process.env.CONTEXTIFY_DEBUG === 'true') {
    console.error('[contextify:generator]', ...args);
  }
};

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
  debug(`analyzing ${filePath}`);
  const analysis = analyzeFile(filePath);
  if (analysis.error) {
    debug(`analysis error: ${analysis.error}`);
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
    debug(`smartDiff action=${diff.action} reason=${diff.reason || '-'}`);

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

  // Build prompt
  const userPrompt = buildUserPrompt({
    analysis,
    sourceCode,
    developerInput,
    existingContext,
  });

  // Call LLM
  debug(`calling LLM for ${filePath}`);
  let contextContent;
  try {
    contextContent = await callLLM(config, config._systemPrompt || SYSTEM_PROMPT, userPrompt);
    debug(`LLM response length=${contextContent.length}`);
  } catch (err) {
    debug(`LLM error: ${err.message}`);
    return {
      file: filePath,
      action: 'error',
      message: `LLM call failed: ${err.message}`,
      contextPath,
    };
  }

  // Clean up response - remove any markdown fencing the LLM might add around the whole response
  contextContent = cleanLLMResponse(contextContent);

  // Prepend the auto-generated header (always present regardless of which prompt was used)
  const hash = structuralHash(analysis);
  const header = [
    `<!-- @contextify-ai v${version} | auto-generated -->`,
    `<!-- source: ${filePath} -->`,
    `<!-- updated: ${new Date().toISOString()} -->`,
    `<!-- structural_hash: ${hash} -->`,
    '',
  ].join('\n');
  contextContent = header + contextContent;

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
  const { concurrency = config.concurrency || 5, onProgress } = options;
  const results = [];
  const queue = [...files];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;
      const result = await generateContext(file, config, options);
      results.push(result);
      if (onProgress) onProgress(result);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}

/**
 * Clean up LLM response.
 *
 * Handles three failure modes that occur together or independently:
 *   1. Preamble text before the fence  ("Here is the updated file:\n```markdown")
 *   2. Outer markdown fence wrapping   (```markdown ... ```)
 *   3. Echoed auto-generated headers   (<!-- @contextify-ai ... --> lines)
 *
 * Strategy: if any code fence appears before the first `# ` heading, the
 * response is wrapped — extract everything between that fence and the last
 * closing fence. Then strip any echoed header lines.
 */
function cleanLLMResponse(content) {
  let cleaned = content.trim();

  // Locate the title line (# ComponentName) — the true start of the content.
  let titleStart;
  if (cleaned.startsWith('# ')) {
    titleStart = 0;
  } else {
    const idx = cleaned.indexOf('\n# ');
    titleStart = idx !== -1 ? idx + 1 : Infinity;
  }

  // Locate the first code fence in the response.
  const firstFence = cleaned.search(/```[a-zA-Z]*/);

  // If a fence appears before the title the LLM wrapped its output (case 1+2).
  // Extract everything between the opening fence line and the last closing fence.
  if (firstFence !== -1 && firstFence < titleStart) {
    const openFenceEnd = cleaned.indexOf('\n', firstFence) + 1;
    const afterOpen = cleaned.slice(openFenceEnd);
    const lastFence = afterOpen.lastIndexOf('\n```');
    cleaned = (lastFence !== -1 ? afterOpen.slice(0, lastFence) : afterOpen).trim();
  }

  // Strip echoed auto-generated header lines (case 3).
  // The generator re-adds these itself, so any copy in the LLM output is a duplicate.
  cleaned = cleaned
    .replace(/^(<!--\s*@contextify-ai[^\n]*-->\r?\n|<!--\s*(?:source|updated|structural_hash):[^\n]*-->\r?\n)+/, '')
    .trim();

  return cleaned + '\n';
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
