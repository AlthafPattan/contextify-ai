const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../core/config');
const { getAllScopedFiles } = require('../core/git');
const { getContextPath } = require('../core/smart-diff');
const { buildIndex } = require('../core/indexer');

/**
 * Delete .context.md files for specific files or the whole project.
 * Does NOT regenerate — use `contextify regen` after if needed.
 */
async function resetCommand(files, options) {
  const config = await loadConfig();
  const root = config._root;
  const force = options.force || false;

  // ── Resolve target context paths ──────────────
  let contextPaths = [];

  if (files && files.length > 0) {
    // Specific source files provided — resolve their .context.md paths
    for (const f of files) {
      const absSource = path.resolve(root, f);
      const ctxPath = getContextPath(absSource, config);
      if (fs.existsSync(ctxPath)) {
        contextPaths.push(ctxPath);
      } else {
        console.log(chalk.dim(`  - ${path.relative(root, ctxPath)} (not found, skipping)`));
      }
    }
  } else {
    // No files given — find all .context.md in the project
    const { glob } = require('glob');
    const found = await glob('**/*.context.md', {
      cwd: root,
      ignore: ['node_modules/**', 'dist/**', 'build/**'],
      absolute: true,
    });
    contextPaths = found;
  }

  if (contextPaths.length === 0) {
    console.log(chalk.yellow('\n  No .context.md files found to reset.\n'));
    return;
  }

  // ── Show what will be deleted ──────────────────
  console.log('');
  console.log(chalk.cyan.bold('  contextify-ai') + chalk.dim(' - reset'));
  console.log('');
  console.log(chalk.dim(`  The following ${contextPaths.length} file(s) will be deleted:`));
  for (const p of contextPaths) {
    console.log(chalk.red(`    - ${path.relative(root, p)}`));
  }
  console.log('');

  // ── Confirm unless --force ─────────────────────
  if (!force && process.stdin.isTTY) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Delete ${contextPaths.length} .context.md file(s)? This cannot be undone.`,
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.dim('  Aborted.\n'));
      return;
    }
  }

  // ── Delete files ───────────────────────────────
  let deleted = 0;
  let errors = 0;

  for (const p of contextPaths) {
    try {
      fs.unlinkSync(p);
      console.log(chalk.red(`  ✗ ${path.relative(root, p)}`));
      deleted++;
    } catch (err) {
      console.log(chalk.dim(`  ! ${path.relative(root, p)}: ${err.message}`));
      errors++;
    }
  }

  // ── Rebuild index (or delete it if nothing left) ─
  const indexPath = path.join(root, '.contexts', 'index.md');
  const indexResult = await buildIndex(config);
  if (!indexResult && fs.existsSync(indexPath)) {
    fs.unlinkSync(indexPath);
    console.log(chalk.red(`  ✗ .contexts/index.md`));
  } else if (indexResult) {
    console.log(chalk.dim(`  ✓ Index updated (${indexResult.totalFiles} entries remaining)`));
  }

  console.log('');
  console.log(chalk.dim(`  ${deleted} file(s) deleted${errors ? `, ${errors} error(s)` : ''}. Run \`contextify regen\` to regenerate.`));
  console.log('');
}

module.exports = { resetCommand };
