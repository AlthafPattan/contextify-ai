const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const { loadConfig } = require('../core/config');
const { generateBatch } = require('../core/generator');
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
  const concurrency = parseInt(options.concurrency, 10) || config.concurrency;
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
  const allResults = [];
  let processed = 0;
  const total = targetFiles.length;
  const startedAt = new Date();
  const spinner = ora(`Processing 0/${total} files...`).start();

  await generateBatch(targetFiles, config, {
    force: true,
    developerInput: message,
    concurrency,
    onProgress: (result) => {
      allResults.push(result);
      processed++;
      const rel = path.relative(root, result.file);
      spinner.clear();
      if (result.action === 'generated') {
        console.log(chalk.green('  +') + chalk.dim(` ${rel}`));
      } else if (result.action === 'updated') {
        console.log(chalk.yellow('  ~') + chalk.dim(` ${rel}`));
      } else if (result.action === 'error') {
        console.log(chalk.red(`  ✗ ${rel}: ${result.message}`));
      }
      spinner.text = `Processing ${processed}/${total} files...`;
      spinner.render();
    },
  });

  spinner.stop();

  // ── Results ────────────────────────────────────
  const generated = allResults.filter(r => r.action === 'generated');
  const updated = allResults.filter(r => r.action === 'updated');
  const errors = allResults.filter(r => r.action === 'error');

  console.log('');
  if (generated.length > 0) console.log(chalk.green(`  ✓ ${generated.length} generated`));
  if (updated.length > 0) console.log(chalk.green(`  ✓ ${updated.length} regenerated`));
  if (errors.length > 0) console.log(chalk.red(`  ✗ ${errors.length} error(s)`));

  // ── Rebuild index ──────────────────────────────
  if (generated.length > 0 || updated.length > 0) {
    const indexResult = await buildIndex(config);
    if (indexResult) {
      console.log(chalk.green(`  ✓ Index updated (${indexResult.totalFiles} entries)`));
    }
  }

  const finishedAt = new Date();
  const duration = finishedAt - startedAt;
  const durationStr = duration < 60000
    ? `${(duration / 1000).toFixed(1)}s`
    : `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;

  console.log('');
  console.log(chalk.dim(`  Started  ${startedAt.toLocaleTimeString()}`));
  console.log(chalk.dim(`  Finished ${finishedAt.toLocaleTimeString()}  (${durationStr})`));
  console.log('');
}

module.exports = { regenCommand };
