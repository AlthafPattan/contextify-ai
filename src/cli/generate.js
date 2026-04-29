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
  const concurrency = parseInt(options.concurrency, 10) || config.concurrency;

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
  const allResults = [];
  let processed = 0;
  const total = targetFiles.length;
  const startedAt = new Date();
  const spinner = ora(`Processing 0/${total} files...`).start();

  await generateBatch(targetFiles, config, {
    force,
    concurrency,
    onProgress: (result) => {
      allResults.push(result);
      processed++;
      const rel = path.relative(config._root, result.file);
      spinner.clear();
      if (result.action === 'generated') {
        console.log(chalk.green('  +') + chalk.dim(` ${rel}`));
      } else if (result.action === 'updated') {
        console.log(chalk.yellow('  ~') + chalk.dim(` ${rel}`));
      } else if (result.action === 'no-change') {
        console.log(chalk.dim(`  - ${rel} (no structural changes)`));
      } else if (result.action === 'error') {
        console.log(chalk.red(`  ✗ ${rel}: ${result.message}`));
      }
      spinner.text = `Processing ${processed}/${total} files...`;
      spinner.render();
    },
  });

  spinner.stop();

  // Results summary
  const generated = allResults.filter(r => r.action === 'generated');
  const updated = allResults.filter(r => r.action === 'updated');
  const noChange = allResults.filter(r => r.action === 'no-change');
  const errors = allResults.filter(r => r.action === 'error');

  console.log('');
  if (generated.length > 0) console.log(chalk.green(`  ✓ ${generated.length} generated`));
  if (updated.length > 0) console.log(chalk.green(`  ✓ ${updated.length} updated`));
  if (noChange.length > 0) console.log(chalk.dim(`  - ${noChange.length} unchanged`));
  if (errors.length > 0) console.log(chalk.red(`  ✗ ${errors.length} error(s)`));

  // Rebuild index
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

module.exports = { generateCommand };
