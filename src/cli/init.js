const chalk = require('chalk');
const inquirer = require('inquirer');
const ora = require('ora');
const fs = require('fs');
const path = require('path');
const { writeDefaultConfig, getDefaultModel } = require('../core/config');
const { getAllScopedFiles } = require('../core/git');
const { loadConfig } = require('../core/config');
const { generateBatch } = require('../core/generator');
const { buildIndex } = require('../core/indexer');

/**
 * Initialize contextify-ai in a project.
 */
async function initCommand(options) {
  const root = process.cwd();

  console.log('');
  console.log(chalk.cyan.bold('  contextify-ai') + chalk.dim(' - setup wizard'));
  console.log('');

  // ── Check for existing config ─────────────────
  const existingConfig = ['.contextifyrc', 'contextify.config.js', '.contextifyrc.json']
    .find(f => fs.existsSync(path.join(root, f)));

  if (existingConfig) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: `Found existing ${existingConfig}. Overwrite?`,
      default: false,
    }]);

    if (!overwrite) {
      console.log(chalk.dim('  Keeping existing config.\n'));
      return;
    }
  }

  // ── Provider selection ────────────────────────
  const { provider } = await inquirer.prompt([{
    type: 'list',
    name: 'provider',
    message: 'Which LLM provider?',
    choices: [
      { name: 'Claude (Anthropic)', value: 'claude' },
      { name: 'GPT (OpenAI)', value: 'openai' },
      { name: 'Ollama (Local)', value: 'ollama' },
    ],
    default: options.provider || 'claude',
  }]);

  // ── Model selection ───────────────────────────
  const defaultModel = getDefaultModel(provider);
  const { model } = await inquirer.prompt([{
    type: 'input',
    name: 'model',
    message: `Model to use:`,
    default: options.model || defaultModel,
  }]);

  // ── API key check ─────────────────────────────
  if (provider !== 'ollama') {
    const envVar = provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    const hasKey = !!process.env[envVar];

    if (!hasKey) {
      console.log('');
      console.log(chalk.yellow(`  ⚠ ${envVar} not found in environment.`));
      console.log(chalk.dim(`    Set it in your shell profile or .env file.`));
      console.log(chalk.dim(`    The config will reference env:${envVar}\n`));
    }
  }

  // ── Mode selection ────────────────────────────
  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'Hook mode:',
    choices: [
      { name: 'Pre-commit (interactive, context in same commit)', value: 'pre-commit' },
      { name: 'Post-commit (background, auto follow-up commit)', value: 'post-commit' },
    ],
    default: options.mode || 'pre-commit',
  }]);

  // ── AI tools integration ──────────────────────
  const toolChoices = [
    { name: 'Claude Code (CLAUDE.md)', value: 'claudeCode' },
    { name: 'Cursor (.cursor/rules)', value: 'cursor' },
    { name: 'Copilot (.github/copilot-instructions.md)', value: 'copilot' },
    { name: 'Windsurf (.windsurfrules)', value: 'windsurf' },
  ];

  const { tools } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'tools',
    message: 'Which AI tools do you use? (we\'ll add context file references)',
    choices: toolChoices,
  }]);

  const toolsConfig = {
    claudeCode: tools.includes('claudeCode'),
    cursor: tools.includes('cursor'),
    copilot: tools.includes('copilot'),
    windsurf: tools.includes('windsurf'),
  };

  // ── Write config ──────────────────────────────
  const configPath = writeDefaultConfig(root, {
    provider,
    model,
    mode,
    tools: toolsConfig,
  });

  console.log('');
  console.log(chalk.green(`  ✓ Config written to ${path.relative(root, configPath)}`));

  // ── Set up git hooks ──────────────────────────
  await setupGitHooks(root, mode);

  // ── Set up AI tool integrations ───────────────
  await setupToolIntegrations(root, toolsConfig);

  // ── Add .contexts to .gitignore? ──────────────
  // Actually no - we want .context.md and the index tracked
  // But we should add a note about it

  // ── Offer bulk generation ─────────────────────
  console.log('');
  const { generate } = await inquirer.prompt([{
    type: 'confirm',
    name: 'generate',
    message: 'Generate .context.md for existing files now?',
    default: false,
  }]);

  if (generate) {
    await bulkGenerate(root);
  }

  // ── Done ──────────────────────────────────────
  console.log('');
  console.log(chalk.cyan.bold('  Setup complete!'));
  console.log('');
  console.log(chalk.dim('  Next steps:'));
  console.log(chalk.dim('  1. Make changes to your code'));
  console.log(chalk.dim('  2. git commit - contextify-ai will generate .context.md files'));
  console.log(chalk.dim('  3. AI tools will use .context.md files for better understanding'));
  console.log('');
}

/**
 * Set up git hooks using simple shell scripts (no husky dependency).
 */
async function setupGitHooks(root, mode) {
  const hooksDir = path.join(root, '.git', 'hooks');

  if (!fs.existsSync(path.join(root, '.git'))) {
    console.log(chalk.yellow('  ⚠ No .git directory found. Skipping hook setup.'));
    console.log(chalk.dim('    Run `git init` first, then `contextify init` again.'));
    return;
  }

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookType = mode === 'post-commit' ? 'post-commit' : 'pre-commit';
  const hookPath = path.join(hooksDir, hookType);
  const skipFlag = mode === 'post-commit' ? '--post-commit' : '';

  // Check for existing hook
  let existingContent = '';
  if (fs.existsSync(hookPath)) {
    existingContent = fs.readFileSync(hookPath, 'utf-8');
    if (existingContent.includes('contextify')) {
      console.log(chalk.dim(`  Hook already installed in ${hookType}`));
      return;
    }
  }

  const hookScript = existingContent
    ? `${existingContent}\n\n# contextify-ai\nnpx contextify hook ${skipFlag} "$@"\n`
    : `#!/bin/sh\n\n# contextify-ai\nnpx contextify hook ${skipFlag} "$@"\n`;

  fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
  console.log(chalk.green(`  ✓ Git ${hookType} hook installed`));

  // Also set up prepare-commit-msg for tagging
  const prepareHookPath = path.join(hooksDir, 'prepare-commit-msg');
  let prepareContent = '';
  if (fs.existsSync(prepareHookPath)) {
    prepareContent = fs.readFileSync(prepareHookPath, 'utf-8');
    if (prepareContent.includes('contextify')) return;
  }

  const prepareScript = (prepareContent || '#!/bin/sh\n') + `
# contextify-ai commit message tagging
if [ -n "$CONTEXTIFY_TAG" ]; then
  COMMIT_MSG_FILE="$1"
  CURRENT_MSG=$(cat "$COMMIT_MSG_FILE")
  if echo "$CURRENT_MSG" | grep -q "\\[context:"; then
    : # Already tagged
  else
    echo "$CURRENT_MSG [context: $CONTEXTIFY_TAG]" > "$COMMIT_MSG_FILE"
  fi
fi
`;

  fs.writeFileSync(prepareHookPath, prepareScript, { mode: 0o755 });
  console.log(chalk.green('  ✓ Commit message tagging hook installed'));
}

/**
 * Add context file references to AI tool configs.
 */
async function setupToolIntegrations(root, tools) {
  if (tools.claudeCode) {
    const claudePath = path.join(root, 'CLAUDE.md');
    const snippet = '\n\n## Context Files\n\nFor component-level context, read the colocated `.context.md` file next to any component you\'re working on. For a full project map, see `.contexts/index.md`.\n';

    if (fs.existsSync(claudePath)) {
      const content = fs.readFileSync(claudePath, 'utf-8');
      if (!content.includes('.context.md')) {
        fs.appendFileSync(claudePath, snippet);
        console.log(chalk.green('  ✓ Added context reference to CLAUDE.md'));
      }
    } else {
      fs.writeFileSync(claudePath, `# Project Context\n${snippet}`);
      console.log(chalk.green('  ✓ Created CLAUDE.md with context reference'));
    }
  }

  if (tools.cursor) {
    const rulesDir = path.join(root, '.cursor', 'rules');
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }

    const rulePath = path.join(rulesDir, 'contextify.mdc');
    const ruleContent = `---
description: Component context from contextify-ai
globs: src/**/*
---

When working on any file, check for a colocated .context.md file in the same directory.
Read it for business context, edge cases, and structured metadata about the component.
For a project-wide map, see .contexts/index.md
`;

    fs.writeFileSync(rulePath, ruleContent);
    console.log(chalk.green('  ✓ Created .cursor/rules/contextify.mdc'));
  }

  if (tools.copilot) {
    const copilotDir = path.join(root, '.github');
    if (!fs.existsSync(copilotDir)) {
      fs.mkdirSync(copilotDir, { recursive: true });
    }

    const instrPath = path.join(copilotDir, 'copilot-instructions.md');
    const snippet = '\n\n## Context Files\n\nThis project uses contextify-ai. Each component has a colocated `.context.md` file with business logic, edge cases, and structured metadata. Check `.contexts/index.md` for a project map.\n';

    if (fs.existsSync(instrPath)) {
      const content = fs.readFileSync(instrPath, 'utf-8');
      if (!content.includes('.context.md')) {
        fs.appendFileSync(instrPath, snippet);
        console.log(chalk.green('  ✓ Added context reference to copilot-instructions.md'));
      }
    } else {
      fs.writeFileSync(instrPath, `# Copilot Instructions\n${snippet}`);
      console.log(chalk.green('  ✓ Created .github/copilot-instructions.md'));
    }
  }

  if (tools.windsurf) {
    const windsurfPath = path.join(root, '.windsurfrules');
    const snippet = '\nThis project uses contextify-ai. Each component has a colocated .context.md file. Read it for business context and structured metadata. See .contexts/index.md for a project map.\n';

    if (fs.existsSync(windsurfPath)) {
      const content = fs.readFileSync(windsurfPath, 'utf-8');
      if (!content.includes('.context.md')) {
        fs.appendFileSync(windsurfPath, snippet);
        console.log(chalk.green('  ✓ Added context reference to .windsurfrules'));
      }
    } else {
      fs.writeFileSync(windsurfPath, snippet.trim() + '\n');
      console.log(chalk.green('  ✓ Created .windsurfrules with context reference'));
    }
  }
}

/**
 * Bulk generate .context.md for all existing files.
 */
async function bulkGenerate(root) {
  const config = await loadConfig(root);
  const files = await getAllScopedFiles(config);

  if (files.length === 0) {
    console.log(chalk.dim('  No files matching scope found.'));
    return;
  }

  console.log(chalk.dim(`\n  Found ${files.length} files matching scope.`));

  // Estimate cost
  console.log(chalk.dim(`  Estimated LLM calls: ${files.length}`));
  console.log(chalk.dim(`  Concurrency: ${config.concurrency}\n`));

  const spinner = ora({
    text: `Processing 0/${files.length} files...`,
  }).start();

  let processed = 0;
  const results = [];

  // Process in batches
  const batchSize = config.concurrency;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchResults = await generateBatch(batch, config, {
      concurrency: batchSize,
    });
    results.push(...batchResults);
    processed += batch.length;
    spinner.text = `Processing ${processed}/${files.length} files...`;
  }

  spinner.succeed(`Processed ${files.length} files`);

  // Summary
  const generated = results.filter(r => r.action === 'generated').length;
  const errors = results.filter(r => r.action === 'error').length;

  console.log(chalk.green(`  ✓ ${generated} context files generated`));
  if (errors > 0) {
    console.log(chalk.red(`  ✗ ${errors} errors`));
  }

  // Build index
  const indexResult = await buildIndex(config);
  if (indexResult) {
    console.log(chalk.green(`  ✓ Index created at .contexts/index.md (${indexResult.totalFiles} entries)`));
  }
}

module.exports = { initCommand };
