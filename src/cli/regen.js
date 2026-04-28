const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const { loadConfig } = require('../core/config');
const { generateContext, generateBatch } = require('../core/generator');
const { buildIndex } = require('../core/indexer');
const { getAllScopedFiles } = require('../core/git');

/**
 * Force-regenerate .context.md files, preserving existing edge cases and
 * conditions by passing the current .context.md back to the LLM as context.
 *
 * Unlike `generate --force`, this is the explicit "refresh" workflow —
 * the LLM sees the old file and is instructed to carry forward anything
 * still accurate while updating what has changed.
 */
async function regenCommand(files, options) {
  const config = await loadConfig();
  const root = config._root;
  const concurrency = parseInt(options.concurrency) || config.concurrency;
  const message = options.message || null;

  // ── Resolve target files ───────────────────────
  let targetFiles = files && files.length > 0
    ? files.map(f => path.resolve(root, f))
    : await getAllScopedFiles(config);

  if (targetFiles.length === 0) {
    console.log(chalk.yellow('\n  No files found matching scope.\n'));
    return;
  }

  // ── Header ─────────────────────────────────────
  console.log('');
  console.log(chalk.cyan.bold('  contextify-ai') + chalk.dim(' - regen'));
  console.log(chalk.dim(`  ${targetFiles.length} file(s) | preserving existing edge cases & conditions`));
  if (message) {
    console.log(chalk.dim(`  context: `) + message);
  }
  console.log('');

  // ── Regenerate ─────────────────────────────────
  const spinner = ora({
    text: `Regenerating context files (0/${targetFiles.length})...`,
  }).start();

  let processed = 0;
  const allResults = [];

  for (let i = 0; i < targetFiles.length; i += concurrency) {
    const batch = targetFiles.slice(i, i + concurrency);
    const batchResults = await generateBatch(batch, config, {
      force: true,        // bypass smartDiff hash check
      developerInput: message,
      concurrency,
    });
    allResults.push(...batchResults);
    processed += batch.length;
    spinner.text = `Regenerating context files (${processed}/${targetFiles.length})...`;
  }

  spinner.stop();

  // ── Results ────────────────────────────────────
  const generated = allResults.filter(r => r.action === 'generated');
  const updated = allResults.filter(r => r.action === 'updated');
  const errors = allResults.filter(r => r.action === 'error');

  if (generated.length > 0) {
    console.log(chalk.green(`  ✓ ${generated.length} context file(s) generated`));
    generated.forEach(r => console.log(chalk.dim(`    + ${path.relative(root, r.contextPath)}`)));
  }

  if (updated.length > 0) {
    console.log(chalk.green(`  ✓ ${updated.length} context file(s) regenerated`));
    updated.forEach(r => console.log(chalk.dim(`    ~ ${path.relative(root, r.contextPath)}`)));
  }

  if (errors.length > 0) {
    console.log(chalk.red(`  ✗ ${errors.length} error(s)`));
    errors.forEach(r => console.log(chalk.red(`    ${path.relative(root, r.file)}: ${r.message}`)));
  }

  // ── Rebuild index ──────────────────────────────
  if (generated.length > 0 || updated.length > 0) {
    const indexResult = await buildIndex(config);
    if (indexResult) {
      console.log(chalk.green(`  ✓ Index updated (${indexResult.totalFiles} entries)`));
    }
  }

  console.log('');
}

module.exports = { regenCommand };
