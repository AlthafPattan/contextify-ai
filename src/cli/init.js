const chalk = require("chalk");
const inquirer = require("inquirer");
const ora = require("ora");
const fs = require("fs");
const path = require("path");
const { writeDefaultConfig, getDefaultModel, DEFAULT_CONFIG } = require("../core/config");
const { getAllScopedFiles } = require("../core/git");
const { loadConfig } = require("../core/config");
const { generateBatch } = require("../core/generator");
const { buildIndex } = require("../core/indexer");

/**
 * Initialize contextify-ai in a project.
 */
async function initCommand(options) {
  const root = process.cwd();

  console.log("");
  console.log(
    chalk.cyan.bold("  contextify-ai") + chalk.dim(" - setup wizard")
  );
  console.log("");

  // ── Check for existing config ─────────────────
  const existingConfigFile = [
    ".contextifyrc",
    ".contextifyrc.json",
    "contextify.config.js",
  ].find((f) => fs.existsSync(path.join(root, f)));

  if (existingConfigFile) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `Found existing ${existingConfigFile}. What would you like to do?`,
        choices: [
          { name: "Update (keep your settings, add any new fields)", value: "update" },
          { name: "Reconfigure (run full setup wizard)", value: "overwrite" },
          { name: "Keep as-is", value: "skip" },
        ],
        default: "update",
      },
    ]);

    if (action === "skip") {
      console.log(chalk.dim("  Keeping existing config.\n"));
      return;
    }

    if (action === "update") {
      const existingPath = path.join(root, existingConfigFile);
      let existingData = {};
      try {
        existingData = JSON.parse(fs.readFileSync(existingPath, "utf-8"));
      } catch {
        console.log(chalk.yellow(`  ⚠ Could not parse ${existingConfigFile}. Use Reconfigure to reset it.`));
        return;
      }

      // Fields written by writeDefaultConfig — the canonical schema
      const schema = {
        provider: DEFAULT_CONFIG.provider,
        model: DEFAULT_CONFIG.model,
        mode: DEFAULT_CONFIG.mode,
        include: DEFAULT_CONFIG.include,
        exclude: DEFAULT_CONFIG.exclude,
        output: DEFAULT_CONFIG.output,
        concurrency: DEFAULT_CONFIG.concurrency,
        smartDiff: DEFAULT_CONFIG.smartDiff,
        commitTags: DEFAULT_CONFIG.commitTags,
        tools: DEFAULT_CONFIG.tools,
        systemPrompt: "",
      };

      const addedKeys = Object.keys(schema).filter((k) => !(k in existingData));

      // Merge: existing values take precedence, missing fields get defaults
      const merged = { ...schema, ...existingData };
      merged.tools = { ...schema.tools, ...(existingData.tools || {}) };

      fs.writeFileSync(existingPath, JSON.stringify(merged, null, 2), "utf-8");

      if (addedKeys.length > 0) {
        console.log(chalk.green(`  ✓ Added new fields: ${addedKeys.join(", ")}`));
      } else {
        console.log(chalk.dim("  Config is already up to date."));
      }
      return;
    }

    // action === "overwrite": fall through to full wizard
  }

  // ── Provider selection ────────────────────────
  const { provider } = await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: "Which LLM provider?",
      choices: [
        { name: "GitHub Models (free with GitHub account)", value: "github" },
        { name: "Google Gemini (free tier available)", value: "gemini" },
        { name: "Ollama (free, runs locally)", value: "ollama" },
        { name: "Claude (Anthropic - paid)", value: "claude" },
        { name: "OpenAI GPT (paid)", value: "openai" },
      ],
      default: options.provider || "github",
    },
  ]);

  // ── Model selection ───────────────────────────
  const defaultModel = getDefaultModel(provider);
  const { model } = await inquirer.prompt([
    {
      type: "input",
      name: "model",
      message: `Model to use:`,
      default: options.model || defaultModel,
    },
  ]);

  // ── API key check ─────────────────────────────
  if (provider !== "ollama") {
    const envVarMap = {
      claude: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      github: "GITHUB_TOKEN",
      gemini: "GEMINI_API_KEY",
    };
    const envVar = envVarMap[provider];
    const hasKey = !!process.env[envVar];

    if (!hasKey) {
      console.log("");
      console.log(chalk.yellow(`  ⚠ ${envVar} not found in environment.`));

      if (provider === "github") {
        console.log(
          chalk.dim(
            `    Generate a free token at: https://github.com/settings/tokens`
          )
        );
        console.log(
          chalk.dim(
            `    No special scopes needed - just create a classic token.`
          )
        );
      } else if (provider === "gemini") {
        console.log(
          chalk.dim(
            `    Get a free API key at: https://aistudio.google.com/apikey`
          )
        );
      } else {
        console.log(
          chalk.dim(`    Set it in your shell profile or .env file.`)
        );
      }

      console.log(chalk.dim(`    The config will reference env:${envVar}\n`));
    }
  }

  // ── Mode selection ────────────────────────────
  const { mode } = await inquirer.prompt([
    {
      type: "list",
      name: "mode",
      message: "Hook mode:",
      choices: [
        {
          name: "Pre-commit (interactive, context in same commit)",
          value: "pre-commit",
        },
        {
          name: "Post-commit (background, auto follow-up commit)",
          value: "post-commit",
        },
      ],
      default: options.mode || "pre-commit",
    },
  ]);

  // ── AI tools integration ──────────────────────
  const toolChoices = [
    { name: "Claude Code (CLAUDE.md)", value: "claudeCode" },
    { name: "Cursor (.cursor/rules)", value: "cursor" },
    { name: "Copilot (.github/copilot-instructions.md)", value: "copilot" },
    { name: "Windsurf (.windsurfrules)", value: "windsurf" },
  ];

  const { tools } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "tools",
      message: "Which AI tools do you use? (we'll add context file references)",
      choices: toolChoices,
    },
  ]);

  const toolsConfig = {
    claudeCode: tools.includes("claudeCode"),
    cursor: tools.includes("cursor"),
    copilot: tools.includes("copilot"),
    windsurf: tools.includes("windsurf"),
  };

  // ── Write config ──────────────────────────────
  const configPath = writeDefaultConfig(root, {
    provider,
    model,
    mode,
    tools: toolsConfig,
  });

  console.log("");
  console.log(
    chalk.green(`  ✓ Config written to ${path.relative(root, configPath)}`)
  );

  // ── Set up git hooks ──────────────────────────
  await setupGitHooks(root, mode);

  // ── Set up AI tool integrations ───────────────
  await setupToolIntegrations(root, toolsConfig);

  // ── Add .contexts to .gitignore? ──────────────
  // Actually no - we want .context.md and the index tracked
  // But we should add a note about it

  // ── Offer bulk generation ─────────────────────
  console.log("");
  const { generate } = await inquirer.prompt([
    {
      type: "confirm",
      name: "generate",
      message: "Generate .context.md for existing files now?",
      default: false,
    },
  ]);

  if (generate) {
    await bulkGenerate(root);
  }

  // ── Done ──────────────────────────────────────
  console.log("");
  console.log(chalk.cyan.bold("  Setup complete!"));
  console.log("");
  console.log(chalk.dim("  Next steps:"));
  console.log(chalk.dim("  1. Make changes to your code"));
  console.log(
    chalk.dim("  2. git commit - contextify-ai will generate .context.md files")
  );
  console.log(
    chalk.dim(
      "  3. AI tools will use .context.md files for better understanding"
    )
  );
  console.log("");
}

/**
 * Set up git hooks using simple shell scripts (no husky dependency).
 * contextify must run FIRST so generated .context.md files are staged
 * before lint/format steps pick up staged files.
 */
async function setupGitHooks(root, mode) {
  if (!fs.existsSync(path.join(root, ".git"))) {
    console.log(
      chalk.yellow("  ⚠ No .git directory found. Skipping hook setup.")
    );
    console.log(
      chalk.dim("    Run `git init` first, then `contextify init` again.")
    );
    return;
  }

  const hookType = mode === "post-commit" ? "post-commit" : "pre-commit";
  const skipFlag = mode === "post-commit" ? "--post-commit" : "";

  // Embed the node bin directory so the hook works in non-login shells
  // (e.g. nvm-managed node is not on PATH when git runs hooks via /bin/sh)
  const nodeBinDir = path.dirname(process.execPath);
  const pathExport = `export PATH="${nodeBinDir}:$PATH"`;
  const contextifyBlock = `# contextify-ai (runs first: generates .context.md before lint/format)\n${pathExport}\nnpx contextify hook ${skipFlag} "$@"\n`;

  // ── Detect husky ──────────────────────────────
  // Husky manages its own hook files under .husky/ and overrides .git/hooks.
  // We must write into .husky/ when it's present, otherwise contextify is skipped.
  const huskyDir = path.join(root, ".husky");
  const huskyHookPath = path.join(huskyDir, hookType);
  const isHusky = fs.existsSync(huskyDir);

  if (isHusky) {
    let huskyContent = "";
    if (fs.existsSync(huskyHookPath)) {
      huskyContent = fs.readFileSync(huskyHookPath, "utf-8");
      if (huskyContent.includes("contextify")) {
        console.log(chalk.dim(`  Hook already installed in .husky/${hookType}`));
      } else {
        // Prepend before existing steps so contextify runs before lint-staged etc.
        const shebang = huskyContent.startsWith("#!/") ? huskyContent.split("\n")[0] + "\n" : "";
        const body = shebang ? huskyContent.slice(shebang.length) : huskyContent;
        fs.writeFileSync(huskyHookPath, `${shebang}\n${contextifyBlock}\n${body}`, { mode: 0o755 });
        console.log(chalk.green(`  ✓ Prepended contextify to .husky/${hookType} (runs before lint-staged)`));
      }
    } else {
      fs.writeFileSync(huskyHookPath, `#!/bin/sh\n\n${contextifyBlock}`, { mode: 0o755 });
      console.log(chalk.green(`  ✓ Created .husky/${hookType} with contextify hook`));
    }
  } else {
    // ── Plain .git/hooks ──────────────────────────
    const hooksDir = path.join(root, ".git", "hooks");
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    const hookPath = path.join(hooksDir, hookType);
    let existingContent = "";
    if (fs.existsSync(hookPath)) {
      existingContent = fs.readFileSync(hookPath, "utf-8");
      if (existingContent.includes("contextify")) {
        console.log(chalk.dim(`  Hook already installed in ${hookType}`));
      } else {
        // Prepend after shebang so contextify runs before any existing lint/format steps
        const shebang = existingContent.startsWith("#!/") ? existingContent.split("\n")[0] + "\n" : "";
        const body = shebang ? existingContent.slice(shebang.length) : existingContent;
        fs.writeFileSync(hookPath, `${shebang}\n${contextifyBlock}\n${body}`, { mode: 0o755 });
        console.log(chalk.green(`  ✓ Prepended contextify to ${hookType} hook (runs before lint/format)`));
      }
    } else {
      fs.writeFileSync(hookPath, `#!/bin/sh\n\n${contextifyBlock}`, { mode: 0o755 });
      console.log(chalk.green(`  ✓ Git ${hookType} hook installed`));
    }
  }

  // Also set up prepare-commit-msg for tagging
  const hooksDir = path.join(root, ".git", "hooks");
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }
  const prepareHookPath = path.join(hooksDir, "prepare-commit-msg");
  let prepareContent = "";
  if (fs.existsSync(prepareHookPath)) {
    prepareContent = fs.readFileSync(prepareHookPath, "utf-8");
    if (prepareContent.includes("contextify")) return;
  }

  const prepareScript =
    (prepareContent || "#!/bin/sh\n") +
    `
# contextify-ai commit message tagging
${pathExport}
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
  console.log(chalk.green("  ✓ Commit message tagging hook installed"));
}

/**
 * Add context file references to AI tool configs.
 */
async function setupToolIntegrations(root, tools) {
  if (tools.claudeCode) {
    const claudePath = path.join(root, "CLAUDE.md");
    const snippet =
      "\n\n## Context Files\n\nFor component-level context, read the colocated `.context.md` file next to any component you're working on. For a full project map, see `.contexts/index.md`.\n";

    if (fs.existsSync(claudePath)) {
      const content = fs.readFileSync(claudePath, "utf-8");
      if (!content.includes(".context.md")) {
        fs.appendFileSync(claudePath, snippet);
        console.log(chalk.green("  ✓ Added context reference to CLAUDE.md"));
      }
    } else {
      fs.writeFileSync(claudePath, `# Project Context\n${snippet}`);
      console.log(chalk.green("  ✓ Created CLAUDE.md with context reference"));
    }
  }

  if (tools.cursor) {
    const rulesDir = path.join(root, ".cursor", "rules");
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }

    const rulePath = path.join(rulesDir, "contextify.mdc");
    const ruleContent = `---
description: Component context from contextify-ai
globs: src/**/*
---

When working on any file, check for a colocated .context.md file in the same directory.
Read it for business context, edge cases, and structured metadata about the component.
For a project-wide map, see .contexts/index.md
`;

    fs.writeFileSync(rulePath, ruleContent);
    console.log(chalk.green("  ✓ Created .cursor/rules/contextify.mdc"));
  }

  if (tools.copilot) {
    const copilotDir = path.join(root, ".github");
    if (!fs.existsSync(copilotDir)) {
      fs.mkdirSync(copilotDir, { recursive: true });
    }

    const instrPath = path.join(copilotDir, "copilot-instructions.md");
    const snippet =
      "\n\n## Context Files\n\nThis project uses contextify-ai. Each component has a colocated `.context.md` file with business logic, edge cases, and structured metadata. Check `.contexts/index.md` for a project map.\n";

    if (fs.existsSync(instrPath)) {
      const content = fs.readFileSync(instrPath, "utf-8");
      if (!content.includes(".context.md")) {
        fs.appendFileSync(instrPath, snippet);
        console.log(
          chalk.green("  ✓ Added context reference to copilot-instructions.md")
        );
      }
    } else {
      fs.writeFileSync(instrPath, `# Copilot Instructions\n${snippet}`);
      console.log(chalk.green("  ✓ Created .github/copilot-instructions.md"));
    }
  }

  if (tools.windsurf) {
    const windsurfPath = path.join(root, ".windsurfrules");
    const snippet =
      "\nThis project uses contextify-ai. Each component has a colocated .context.md file. Read it for business context and structured metadata. See .contexts/index.md for a project map.\n";

    if (fs.existsSync(windsurfPath)) {
      const content = fs.readFileSync(windsurfPath, "utf-8");
      if (!content.includes(".context.md")) {
        fs.appendFileSync(windsurfPath, snippet);
        console.log(
          chalk.green("  ✓ Added context reference to .windsurfrules")
        );
      }
    } else {
      fs.writeFileSync(windsurfPath, snippet.trim() + "\n");
      console.log(
        chalk.green("  ✓ Created .windsurfrules with context reference")
      );
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
    console.log(chalk.dim("  No files matching scope found."));
    return;
  }

  console.log(chalk.dim(`\n  Found ${files.length} files matching scope.`));

  // Estimate cost
  console.log(chalk.dim(`  Estimated LLM calls: ${files.length}`));
  console.log(chalk.dim(`  Concurrency: ${config.concurrency}\n`));

  const results = [];
  let processed = 0;
  const total = files.length;
  const startedAt = new Date();
  const spinner = ora(`Processing 0/${total} files...`).start();

  await generateBatch(files, config, {
    concurrency: config.concurrency,
    onProgress: (result) => {
      results.push(result);
      processed++;
      const rel = path.relative(root, result.file);
      spinner.clear();
      if (result.action === "generated") {
        console.log(chalk.green("  +") + chalk.dim(` ${rel}`));
      } else if (result.action === "updated") {
        console.log(chalk.yellow("  ~") + chalk.dim(` ${rel}`));
      } else if (result.action === "error") {
        console.log(chalk.red(`  ✗ ${rel}: ${result.message}`));
      }
      spinner.text = `Processing ${processed}/${total} files...`;
      spinner.render();
    },
  });

  spinner.stop();

  console.log("");
  const generated = results.filter((r) => r.action === "generated").length;
  const errors = results.filter((r) => r.action === "error").length;

  console.log(chalk.green(`  ✓ ${generated} context files generated`));
  if (errors > 0) {
    console.log(chalk.red(`  ✗ ${errors} errors`));
  }

  // Build index
  const indexResult = await buildIndex(config);
  if (indexResult) {
    console.log(
      chalk.green(
        `  ✓ Index created at .contexts/index.md (${indexResult.totalFiles} entries)`
      )
    );
  }

  const finishedAt = new Date();
  const duration = finishedAt - startedAt;
  const durationStr = duration < 60000
    ? `${(duration / 1000).toFixed(1)}s`
    : `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;

  console.log("");
  console.log(chalk.dim(`  Started  ${startedAt.toLocaleTimeString()}`));
  console.log(chalk.dim(`  Finished ${finishedAt.toLocaleTimeString()}  (${durationStr})`));
}

module.exports = { initCommand };
