const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const { loadConfig } = require('../core/config');
const { generateContext, generateBatch } = require('../core/generator');
const { buildIndex } = require('../core/indexer');
const { getAllScopedFiles } = require('../core/git');

/**
 * Generate .context.md files manually.
 * Can target specific files or all files matching scope.
 */
async function generateCommand(files, options) {
  const config = await loadConfig();
  const force = options.force || false;
  const dryRun = options.dryRun || false;
  const concurrency = parseInt(options.concurrency) || config.concurrency;

  let targetFiles = files;

  // If no specific files given, find all matching files
  if (!targetFiles || targetFiles.length === 0) {
    targetFiles = await getAllScopedFiles(config);
  } else {
    // Resolve relative paths
    targetFiles = targetFiles.map(f => path.resolve(config._root, f));
  }

  if (targetFiles.length === 0) {
    console.log(chalk.yellow('\n  No files found matching scope.\n'));
    return;
  }

  console.log('');
  console.log(chalk.cyan.bold('  contextify-ai') + chalk.dim(` - ${dryRun ? 'dry run' : 'generate'}`));
  console.log(chalk.dim(`  ${targetFiles.length} file(s) | concurrency: ${concurrency} | force: ${force}`));
  console.log('');

  if (dryRun) {
    // Dry run - just show what would happen
    for (const filePath of targetFiles) {
      const result = await generateContext(filePath, config, { force, dryRun: true });
      const relPath = path.relative(config._root, filePath);

      switch (result.action) {
        case 'would-generate':
          console.log(chalk.green(`  + ${relPath}`) + chalk.dim(' (new)'));
          break;
        case 'would-update':
          console.log(chalk.yellow(`  ~ ${relPath}`) + chalk.dim(' (update)'));
          if (result.changes) {
            result.changes.forEach(c => console.log(chalk.dim(`      ${c}`)));
          }
          break;
        case 'no-change':
          console.log(chalk.dim(`  - ${relPath} (no structural changes)`));
          break;
        case 'error':
          console.log(chalk.red(`  ✗ ${relPath}: ${result.message}`));
          break;
      }
    }

    const wouldProcess = targetFiles.length;
    console.log(chalk.dim(`\n  Dry run complete. ${wouldProcess} file(s) would be processed.\n`));
    return;
  }

  // Actual generation
  const spinner = ora({
    text: `Generating context files (0/${targetFiles.length})...`,
  }).start();

  let processed = 0;
  const allResults = [];

  // Process in batches
  for (let i = 0; i < targetFiles.length; i += concurrency) {
    const batch = targetFiles.slice(i, i + concurrency);
    const batchResults = await generateBatch(batch, config, {
      force,
      concurrency,
    });
    allResults.push(...batchResults);
    processed += batch.length;
    spinner.text = `Generating context files (${processed}/${targetFiles.length})...`;
  }

  spinner.stop();

  // Results summary
  const generated = allResults.filter(r => r.action === 'generated');
  const updated = allResults.filter(r => r.action === 'updated');
  const noChange = allResults.filter(r => r.action === 'no-change');
  const errors = allResults.filter(r => r.action === 'error');

  if (generated.length > 0) {
    console.log(chalk.green(`  ✓ ${generated.length} context file(s) generated`));
    generated.forEach(r => {
      console.log(chalk.dim(`    + ${path.relative(config._root, r.contextPath)}`));
    });
  }

  if (updated.length > 0) {
    console.log(chalk.green(`  ✓ ${updated.length} context file(s) updated`));
    updated.forEach(r => {
      console.log(chalk.dim(`    ~ ${path.relative(config._root, r.contextPath)}`));
    });
  }

  if (noChange.length > 0) {
    console.log(chalk.dim(`  - ${noChange.length} file(s) unchanged`));
  }

  if (errors.length > 0) {
    console.log(chalk.red(`  ✗ ${errors.length} error(s)`));
    errors.forEach(r => {
      console.log(chalk.red(`    ${path.relative(config._root, r.file)}: ${r.message}`));
    });
  }

  // Rebuild index
  if (generated.length > 0 || updated.length > 0) {
    const indexResult = await buildIndex(config);
    if (indexResult) {
      console.log(chalk.green(`  ✓ Index updated (${indexResult.totalFiles} entries)`));
    }
  }

  console.log('');
}

module.exports = { generateCommand };
