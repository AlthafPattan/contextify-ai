const fs = require('fs');
const path = require('path');
const { structuralHash } = require('./analyzer');

/**
 * Determine if a file's changes warrant an LLM call.
 *
 * Returns:
 *   'generate'   - new file, no .context.md exists
 *   'update'     - structural changes detected, needs LLM update
 *   'no-change'  - only cosmetic changes, skip LLM call
 *   'skip'       - file doesn't match scope or is excluded
 */
function smartDiff(analysis, config) {
  const contextPath = getContextPath(analysis.filePath, config);

  // No existing context file - needs generation
  if (!fs.existsSync(contextPath)) {
    return {
      action: 'generate',
      reason: 'No .context.md file exists',
      contextPath,
    };
  }

  // Read existing context file to get stored hash
  const existingContent = fs.readFileSync(contextPath, 'utf-8');
  const storedHash = extractHash(existingContent);
  const currentHash = structuralHash(analysis);

  // Compare structural hashes
  if (storedHash && storedHash === currentHash) {
    return {
      action: 'no-change',
      reason: 'No structural changes detected (props, exports, hooks, dependencies unchanged)',
      contextPath,
    };
  }

  // Structural changes detected
  return {
    action: 'update',
    reason: 'Structural changes detected',
    contextPath,
    changes: detectChanges(existingContent, analysis),
  };
}

/**
 * Get the path where the .context.md file should live.
 */
function getContextPath(sourcePath, config) {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath));

  if (config.output === 'centralized') {
    const relDir = path.relative(config._root, dir);
    return path.join(config._root, config.outputDir, relDir, `${base}.context.md`);
  }

  // Colocated (default)
  return path.join(dir, `${base}.context.md`);
}

/**
 * Extract the structural hash from an existing .context.md file.
 */
function extractHash(content) {
  const match = content.match(/<!-- structural_hash: ([a-f0-9]+) -->/);
  return match ? match[1] : null;
}

/**
 * Detect what specifically changed between existing context and new analysis.
 * Returns a human-readable summary for the terminal prompt.
 */
function detectChanges(existingContent, analysis) {
  const changes = [];

  // Extract existing AI context YAML to compare
  const yamlMatch = existingContent.match(/```yaml\n([\s\S]*?)```/);
  if (!yamlMatch) {
    changes.push('Context file format unrecognized - full regeneration needed');
    return changes;
  }

  const yaml = yamlMatch[1];

  // Check for new/removed props
  const existingProps = extractYamlList(yaml, 'props');
  const currentProps = analysis.props.map(p => p.name);
  const newProps = currentProps.filter(p => !existingProps.includes(p));
  const removedProps = existingProps.filter(p => !currentProps.includes(p));
  if (newProps.length) changes.push(`+${newProps.length} new props: ${newProps.join(', ')}`);
  if (removedProps.length) changes.push(`-${removedProps.length} removed props: ${removedProps.join(', ')}`);

  // Check for new/removed hooks
  const existingHooks = extractYamlList(yaml, 'hooks');
  const currentHooks = [...new Set(analysis.hooks.map(h => h.name))];
  const newHooks = currentHooks.filter(h => !existingHooks.includes(h));
  const removedHooks = existingHooks.filter(h => !currentHooks.includes(h));
  if (newHooks.length) changes.push(`+${newHooks.length} new hooks: ${newHooks.join(', ')}`);
  if (removedHooks.length) changes.push(`-${removedHooks.length} removed hooks: ${removedHooks.join(', ')}`);

  // Check for new/removed exports
  const existingExports = extractYamlList(yaml, 'exports');
  const currentExports = analysis.exports.map(e => e.name);
  const newExports = currentExports.filter(e => !existingExports.includes(e));
  const removedExports = existingExports.filter(e => !currentExports.includes(e));
  if (newExports.length) changes.push(`+${newExports.length} new exports: ${newExports.join(', ')}`);
  if (removedExports.length) changes.push(`-${removedExports.length} removed exports: ${removedExports.join(', ')}`);

  // Check for new/removed dependencies
  const existingDeps = extractYamlList(yaml, 'dependencies');
  const currentDeps = [
    ...analysis.dependencies.internal,
    ...analysis.dependencies.external,
  ];
  const newDeps = currentDeps.filter(d => !existingDeps.includes(d));
  if (newDeps.length) changes.push(`+${newDeps.length} new dependencies: ${newDeps.join(', ')}`);

  if (changes.length === 0) {
    changes.push('Structural signature changed (internal reorganization)');
  }

  return changes;
}

/**
 * Simple YAML list extractor - pulls names from YAML sections.
 */
function extractYamlList(yaml, section) {
  const regex = new RegExp(`- name: (\\S+)`, 'g');
  const matches = [];
  let match;
  while ((match = regex.exec(yaml)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

module.exports = {
  smartDiff,
  getContextPath,
};
