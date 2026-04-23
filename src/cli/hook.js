const chalk = require('chalk');
const inquirer = require('inquirer');
const ora = require('ora');
const path = require('path');
const { loadConfig } = require('../core/config');
const { analyzeFile } = require('../core/analyzer');
const { smartDiff } = require('../core/smart-diff');
const { generateContext, generateBatch } = require('../core/generator');
const { buildIndex } = require('../core/indexer');
const {
  getStagedFiles,
  stageContextFiles,
  tagCommitMessage,
  getLastCommitMessage,
} = require('../core/git');

/**
 * Main hook handler - called from git pre-commit or post-commit hook.
 */
async function hookHandler(options) {
  // ── Skip check ────────────────────────────────
  if (options.skipContext || process.env.CONTEXTIFY_SKIP === 'true') {
    console.log(chalk.yellow('\n  contextify-ai: skipped [context: skipped]\n'));
    // In pre-commit, we modify the commit message via prepare-commit-msg
    process.env.CONTEXTIFY_TAG = 'skipped';
    return;
  }

  const config = await loadConfig();
  const isPostCommit = options.postCommit || config.mode === 'post-commit';

  try {
    if (isPostCommit) {
      await handlePostCommit(config);
    } else {
      await handlePreCommit(config);
    }
  } catch (err) {
    // Never block the commit on error
    console.error(chalk.red(`\n  contextify-ai error: ${err.message}\n`));
    process.env.CONTEXTIFY_TAG = 'error';
  }
}

/**
 * Pre-commit mode: interactive prompt, LLM calls, auto-stage.
 */
async function handlePreCommit(config) {
  // Get staged files matching scope
  const stagedFiles = await getStagedFiles(config);

  if (stagedFiles.length === 0) {
    return; // Nothing to do
  }

  // Analyze each file and determine what needs processing
  const fileAnalysis = [];
  for (const filePath of stagedFiles) {
    const analysis = analyzeFile(filePath);
    const diff = config.smartDiff
      ? smartDiff(analysis, config)
      : { action: 'update', contextPath: null };

    fileAnalysis.push({ filePath, analysis, diff });
  }

  // Separate into files needing LLM vs. auto-skip
  const needsLLM = fileAnalysis.filter(f =>
    f.diff.action === 'generate' || f.diff.action === 'update'
  );
  const noChange = fileAnalysis.filter(f => f.diff.action === 'no-change');

  if (needsLLM.length === 0) {
    if (noChange.length > 0) {
      process.env.CONTEXTIFY_TAG = 'no-change';
    }
    return;
  }

  // ── Display header ────────────────────────────
  console.log('');
  console.log(chalk.cyan('  ┌─ contextify-ai ─────────────────────────────'));
  console.log(chalk.cyan('  │'));

  // Show files needing context generation
  for (const item of needsLLM) {
    const relPath = path.relative(config._root, item.filePath);
    const icon = item.diff.action === 'generate' ? chalk.green('+ new') : chalk.yellow('~ update');
    console.log(chalk.cyan('  │  ') + `${icon}  ${relPath}`);

    if (item.diff.changes && item.diff.changes.length > 0) {
      for (const change of item.diff.changes) {
        console.log(chalk.cyan('  │  ') + chalk.dim(`       ${change}`));
      }
    }
  }

  if (noChange.length > 0) {
    console.log(chalk.cyan('  │'));
    console.log(chalk.cyan('  │  ') + chalk.dim(`${noChange.length} file(s) with no structural changes - skipped`));
  }

  console.log(chalk.cyan('  │'));

  // ── Prompt developer for input ────────────────
  let developerInput = null;

  // Only prompt if stdin is a TTY (interactive terminal)
  if (process.stdin.isTTY) {
    try {
      const { input } = await inquirer.prompt([
        {
          type: 'input',
          name: 'input',
          message: chalk.cyan('  │  ') + 'What changed and why? (enter to skip)',
          prefix: '',
        },
      ]);
      developerInput = input.trim() || null;
    } catch {
      // Non-interactive, skip prompt
    }
  }

  console.log(chalk.cyan('  │'));

  // ── Generate context files ────────────────────
  const spinner = ora({
    text: 'Generating .context.md files...',
    prefixText: chalk.cyan('  │ '),
  }).start();

  const filesToProcess = needsLLM.map(f => f.filePath);
  const results = await generateBatch(filesToProcess, config, {
    developerInput,
    concurrency: config.concurrency,
  });

  spinner.stop();

  // ── Display results ───────────────────────────
  const generated = results.filter(r => r.action === 'generated');
  const updated = results.filter(r => r.action === 'updated');
  const errors = results.filter(r => r.action === 'error');

  // Show intent warnings
  const warnings = results.filter(r => r.intentWarning);
  if (warnings.length > 0) {
    console.log(chalk.cyan('  │'));
    console.log(chalk.cyan('  │  ') + chalk.yellow('Intent checks:'));
    for (const w of warnings) {
      const relPath = path.relative(config._root, w.file);
      console.log(chalk.cyan('  │  ') + chalk.yellow(`  ⚠ ${relPath}: ${w.intentWarning}`));
    }
  }

  // Summary
  console.log(chalk.cyan('  │'));
  if (generated.length) {
    console.log(chalk.cyan('  │  ') + chalk.green(`✓ ${generated.length} context file(s) generated`));
  }
  if (updated.length) {
    console.log(chalk.cyan('  │  ') + chalk.green(`✓ ${updated.length} context file(s) updated`));
  }
  if (errors.length) {
    console.log(chalk.cyan('  │  ') + chalk.red(`✗ ${errors.length} error(s)`));
    for (const e of errors) {
      console.log(chalk.cyan('  │  ') + chalk.red(`  ${path.relative(config._root, e.file)}: ${e.message}`));
    }
  }

  console.log(chalk.cyan('  │'));
  console.log(chalk.cyan('  └──────────────────────────────────────────────'));
  console.log('');

  // ── Confirmation prompt ───────────────────────
  if (process.stdin.isTTY && warnings.length > 0) {
    try {
      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Proceed with commit?',
          default: true,
        },
      ]);

      if (!proceed) {
        console.log(chalk.yellow('Commit aborted by user.'));
        process.exit(1);
      }
    } catch {
      // Non-interactive, proceed
    }
  }

  // ── Stage generated files ─────────────────────
  const contextPaths = results
    .filter(r => r.contextPath && (r.action === 'generated' || r.action === 'updated'))
    .map(r => r.contextPath);

  if (contextPaths.length > 0) {
    await stageContextFiles(contextPaths, config);

    // Rebuild and stage index
    const indexResult = await buildIndex(config);
    if (indexResult) {
      await stageContextFiles([indexResult.path], config);
    }
  }

  // Set tag for commit message
  if (generated.length > 0 && updated.length === 0) {
    process.env.CONTEXTIFY_TAG = 'generated';
  } else if (updated.length > 0) {
    process.env.CONTEXTIFY_TAG = 'updated';
  } else if (errors.length > 0) {
    process.env.CONTEXTIFY_TAG = 'error';
  }
}

/**
 * Post-commit mode: uses commit message as intent, runs in background.
 */
async function handlePostCommit(config) {
  const commitMessage = await getLastCommitMessage(config);
  const stagedFiles = await getStagedFiles(config);

  if (stagedFiles.length === 0) return;

  console.log(chalk.cyan('\n  contextify-ai: generating context files in background...\n'));

  const results = await generateBatch(stagedFiles, config, {
    developerInput: commitMessage,
    concurrency: config.concurrency,
  });

  const contextPaths = results
    .filter(r => r.contextPath && (r.action === 'generated' || r.action === 'updated'))
    .map(r => r.contextPath);

  if (contextPaths.length > 0) {
    // Rebuild index
    await buildIndex(config);

    // In post-commit, we create a follow-up commit
    const simpleGit = require('simple-git');
    const git = simpleGit(config._root);

    for (const cp of contextPaths) {
      await git.add(path.relative(config._root, cp));
    }
    await git.add('.contexts/index.md');
    await git.commit('chore: update .context.md files [context: auto-updated]', { '--no-verify': null });

    const generated = results.filter(r => r.action === 'generated').length;
    const updated = results.filter(r => r.action === 'updated').length;
    console.log(chalk.green(`  ✓ ${generated + updated} context file(s) committed\n`));
  }
}

module.exports = { hookHandler };
