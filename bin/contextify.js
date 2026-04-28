#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');
const { initCommand } = require('../src/cli/init');
const { generateCommand } = require('../src/cli/generate');
const { auditCommand } = require('../src/cli/audit');
const { hookHandler } = require('../src/cli/hook');
const { resetCommand } = require('../src/cli/reset');
const { regenCommand } = require('../src/cli/regen');

const program = new Command();

program
  .name('contextify')
  .description(chalk.bold('contextify-ai') + ' - AI-powered .context.md files, auto-generated at every commit')
  .version(pkg.version);

// ── init ──────────────────────────────────────────────
program
  .command('init')
  .description('Initialize contextify-ai in your project. Sets up config, git hooks, and optionally generates .context.md for existing files.')
  .option('--provider <provider>', 'LLM provider: claude | openai | ollama', 'claude')
  .option('--model <model>', 'Model to use')
  .option('--mode <mode>', 'Hook mode: pre-commit | post-commit', 'pre-commit')
  .option('--tools <tools>', 'AI tools to integrate: claude-code,cursor,copilot,windsurf', '')
  .action(initCommand);

// ── generate ──────────────────────────────────────────
program
  .command('generate [files...]')
  .description('Generate .context.md files for specified files or all matching files.')
  .option('--force', 'Regenerate even if .context.md exists', false)
  .option('--dry-run', 'Show what would be generated without calling the LLM', false)
  .option('--concurrency <n>', 'Max parallel LLM calls', '5')
  .action(generateCommand);

// ── audit ─────────────────────────────────────────────
program
  .command('audit')
  .description('Find files missing .context.md or with stale context files.')
  .option('--stale', 'Check for stale context files based on source hash', false)
  .action(auditCommand);

// ── hook ──────────────────────────────────────────────
program
  .command('hook')
  .description('Run from git pre-commit/post-commit hook. Not intended to be called directly.')
  .option('--skip-context', 'Skip context generation for this commit')
  .option('--post-commit', 'Run in post-commit mode (uses commit message as intent)')
  .option('-m, --message <message>', 'Developer note on what changed and why (feeds the LLM for richer use cases and edge cases)')
  .action(hookHandler);

// ── reset ─────────────────────────────────────────────
program
  .command('reset [files...]')
  .description('Delete .context.md files for specific source files, or all of them if no files given.')
  .option('--force', 'Skip confirmation prompt', false)
  .action(resetCommand);

// ── regen ─────────────────────────────────────────────
program
  .command('regen [files...]')
  .description('Force-regenerate .context.md files, preserving existing edge cases and conditions.')
  .option('-m, --message <message>', 'What changed and why (fed to the LLM to focus edge case updates)')
  .option('--concurrency <n>', 'Max parallel LLM calls', '5')
  .action(regenCommand);

program.parse();
