const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('../core/config');
const { getAllScopedFiles } = require('../core/git');
const { getContextPath } = require('../core/smart-diff');
const { analyzeFile, structuralHash } = require('../core/analyzer');

/**
 * Audit the project for missing or stale .context.md files.
 */
async function auditCommand(options) {
  const config = await loadConfig();
  const checkStale = options.stale || false;

  const files = await getAllScopedFiles(config);

  if (files.length === 0) {
    console.log(chalk.yellow('\n  No files found matching scope.\n'));
    return;
  }

  console.log('');
  console.log(chalk.cyan.bold('  contextify-ai') + chalk.dim(' - audit'));
  console.log(chalk.dim(`  Scanning ${files.length} files...\n`));

  const missing = [];
  const stale = [];
  const current = [];
  const errors = [];

  for (const filePath of files) {
    const relPath = path.relative(config._root, filePath);
    const contextPath = getContextPath(filePath, config);

    // Check if .context.md exists
    if (!fs.existsSync(contextPath)) {
      missing.push(relPath);
      continue;
    }

    // Check staleness
    if (checkStale) {
      try {
        const analysis = analyzeFile(filePath);
        const currentHash = structuralHash(analysis);
        const contextContent = fs.readFileSync(contextPath, 'utf-8');
        const storedHash = contextContent.match(/<!-- structural_hash: ([a-f0-9]+) -->/);

        if (!storedHash) {
          stale.push({ file: relPath, reason: 'No structural hash found in context file' });
        } else if (storedHash[1] !== currentHash) {
          stale.push({ file: relPath, reason: 'Structural changes detected since last generation' });
        } else {
          current.push(relPath);
        }
      } catch (err) {
        errors.push({ file: relPath, error: err.message });
      }
    } else {
      current.push(relPath);
    }
  }

  // ── Display results ───────────────────────────
  if (missing.length > 0) {
    console.log(chalk.red(`  Missing .context.md (${missing.length}):`));
    missing.forEach(f => console.log(chalk.red(`    - ${f}`)));
    console.log('');
  }

  if (stale.length > 0) {
    console.log(chalk.yellow(`  Stale .context.md (${stale.length}):`));
    stale.forEach(s => console.log(chalk.yellow(`    ~ ${s.file}`) + chalk.dim(` (${s.reason})`)));
    console.log('');
  }

  if (errors.length > 0) {
    console.log(chalk.red(`  Errors (${errors.length}):`));
    errors.forEach(e => console.log(chalk.red(`    ✗ ${e.file}: ${e.error}`)));
    console.log('');
  }

  // Summary
  const total = files.length;
  const coverage = ((current.length / total) * 100).toFixed(1);

  console.log(chalk.dim('  ─────────────────────────────────'));
  console.log(`  Total files in scope:  ${chalk.bold(total)}`);
  console.log(`  With .context.md:      ${chalk.green(current.length)}`);
  console.log(`  Missing .context.md:   ${chalk.red(missing.length)}`);
  if (checkStale) {
    console.log(`  Stale .context.md:     ${chalk.yellow(stale.length)}`);
  }
  console.log(`  Coverage:              ${coverage >= 80 ? chalk.green(coverage + '%') : chalk.yellow(coverage + '%')}`);
  console.log('');

  // Exit with non-zero if missing files (useful for CI)
  if (missing.length > 0) {
    process.exitCode = 1;
  }
}

module.exports = { auditCommand };
