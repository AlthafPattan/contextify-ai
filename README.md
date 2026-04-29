[![npm version](https://img.shields.io/npm/v/contextify-ai?style=flat-square&color=0F3460)](https://www.npmjs.com/package/contextify-ai)
[![npm downloads](https://img.shields.io/npm/dm/contextify-ai?style=flat-square&color=0A7E8C)](https://www.npmjs.com/package/contextify-ai)
[![GitHub stars](https://img.shields.io/github/stars/AlthafPattan/contextify-ai?style=flat-square&color=E76F51)](https://github.com/AlthafPattan/contextify-ai)
[![license](https://img.shields.io/github/license/AlthafPattan/contextify-ai?style=flat-square)](https://github.com/AlthafPattan/contextify-ai/blob/main/LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/AlthafPattan/contextify-ai/pulls)

# contextify-ai

**AI tools read your code. They can't read your mind.**
Auto-generate `.context.md` files at commit time so both humans and AI tools understand your components.

---

## What it does

**contextify-ai** hooks into your git commit workflow, analyzes changed components using AST parsing, asks what you intended, and generates a structured `.context.md` file next to each component.

One file. Two audiences.

- **Top half** — prose for humans: purpose, business rules, edge cases, design decisions
- **Bottom half** — YAML for AI tools: props, state, dependencies, render conditions

```
src/
  PaymentForm/
    PaymentForm.tsx
    PaymentForm.test.tsx
    PaymentForm.module.css
    PaymentForm.context.md    ← generated
```

AI tools like Claude Code, Cursor, and Copilot pick up `.context.md` files automatically through colocation. No plugins. No configuration. Just convention.

→ [Format reference](docs/format.md) · [How it works](docs/how-it-works.md)

---

## Install

```bash
npm install contextify-ai --save-dev
```

## Quick Start

```bash
# Initialize in your project (interactive wizard)
npx contextify init

# Or if installed globally
npm install -g contextify-ai
contextify init
```

The setup wizard will:

1. Ask for your LLM provider (Ollama, GitHub Models, Gemini, Claude, or OpenAI)
2. Let you pick a model
3. Configure include/exclude file patterns
4. Select hook mode (pre-commit or post-commit)
5. Set up AI tool integrations (Claude Code, Cursor, Copilot, Windsurf)
6. Install git hooks
7. Optionally generate `.context.md` for existing files

---

## Supported Providers

| Provider | Config value | Cost | Env Variable | Setup |
| --- | --- | --- | --- | --- |
| Ollama | `ollama` | Free | None needed | [ollama.com](https://ollama.com) — `ollama pull llama3` |
| GitHub Models | `github` | Free | `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) — no special scopes |
| Google Gemini | `gemini` | Free tier | `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Claude | `claude` | Paid | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | `openai` | Paid | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |

---

## Configuration

Running `contextify init` creates a `.contextifyrc` file in your project root:

```json
{
  "provider": "ollama",
  "model": "llama3",
  "mode": "pre-commit",
  "include": [
    "**/index.ts",
    "**/index.tsx",
    "**/index.js",
    "**/index.jsx"
  ],
  "exclude": [
    "**/*.test.*",
    "**/*.spec.*",
    "**/*.stories.*",
    "**/*.story.*",
    "**/*.context.md",
    "**/*.d.ts",
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**"
  ],
  "output": "colocated",
  "concurrency": 5,
  "smartDiff": true,
  "commitTags": true,
  "tools": {
    "claudeCode": false,
    "cursor": false,
    "copilot": false,
    "windsurf": false
  },
  "systemPrompt": ""
}
```

You can also use `.contextifyrc.json`, `.contextifyrc.yaml`, `.contextifyrc.js`, or `contextify.config.js`.

### Custom System Prompt

By default, contextify-ai uses a built-in prompt that produces the standard `.context.md` format. To use your own:

```json
{
  "systemPrompt": "./my-prompt.md"
}
```

The path is resolved relative to your project root. If the file is not found, contextify falls back to the built-in prompt with a warning. See [docs/format.md](docs/format.md) for what the default prompt produces and what to preserve if you customize it.

---

## How it Works

- **Smart diff** — parses your code with Babel, hashes structural elements (props, exports, hooks), and skips the LLM call when nothing meaningful changed. 50–70% fewer LLM calls on active codebases.
- **Developer intent** — prompts you for what changed and why at commit time, or accepts `--message`. Your explanation feeds the LLM as the primary source for edge cases, business rules, and the decision log.
- **Hook ordering** — runs before lint-staged so generated files are staged and lintable. Works with plain `.git/hooks` and Husky.
- **Commit tagging** — tags every commit with `[context: generated|updated|no-change|skipped|error]`.

→ [Full details in docs/how-it-works.md](docs/how-it-works.md)

---

## CLI Commands

### `contextify init`

Interactive setup wizard. Creates config, installs git hooks, sets up AI tool integrations.

### `contextify generate`

Manually generate `.context.md` files outside of the commit flow.

```bash
contextify generate --dry-run               # preview without calling the LLM
contextify generate src/components/Button.tsx
contextify generate                         # all files matching your configured scope
contextify generate --force                 # ignore smart diff
contextify generate --concurrency 3
```

### `contextify audit`

Check your project's context coverage.

```bash
contextify audit           # find files missing .context.md
contextify audit --stale   # also flag stale context files
```

### `contextify hook`

Called automatically by git hooks. Supports flags:

```bash
contextify hook -m "refactored auth to use JWT, session edge cases no longer apply"
CONTEXTIFY_SKIP=true git commit -m "ci: update deps"   # skip context for this commit
```

### `contextify reset`

Delete `.context.md` files. Asks for confirmation unless `--force`.

```bash
contextify reset src/components/PaymentForm.tsx   # single file
contextify reset                                   # entire project
contextify reset --force                           # skip confirmation
```

### `contextify regen`

Force-regenerate `.context.md` files, passing the existing context back to the LLM so it can preserve accurate edge cases while updating what changed.

```bash
contextify regen src/components/PaymentForm.tsx
contextify regen -m "switched from session tokens to JWT across the board"
contextify regen --concurrency 3
```

Full refresh workflow:

```bash
contextify reset --force   # delete all .context.md
contextify regen -m "..."  # regenerate from scratch, guided by your message
```

---

## AI Tool Integration

During `contextify init`, you can select which AI tools you use. contextify-ai adds references so each tool knows to look for `.context.md` files:

| Tool | What gets created |
| --- | --- |
| Claude Code | Adds context reference to `CLAUDE.md` |
| Cursor | Creates `.cursor/rules/contextify.mdc` with auto-attach rules |
| Copilot | Updates `.github/copilot-instructions.md` |
| Windsurf | Updates `.windsurfrules` |

A project-wide index is auto-generated at `.contexts/index.md` — a table of contents listing every context file, categorized by type.

---

## Why Colocation

The `.context.md` file sits next to the component it describes — same convention as `.test.tsx`, `.module.css`, and `.stories.tsx`.

AI tools with file system access discover these files without any integration work. Claude Code reads `PaymentForm.tsx`, checks the same directory for `PaymentForm.context.md`, and understands the props, state, dependencies, and business rules before writing a single line.

Convention over configuration.

---

## Comparison

| Feature | contextify-ai | Repomix | code-contextify | JSDoc | AI commit generators |
| --- | --- | --- | --- | --- | --- |
| Per-component | ✅ | ❌ | ❌ | ✅ | ❌ |
| Commit-hooked | ✅ | ❌ | ❌ | ❌ | ✅ |
| LLM-powered | ✅ | ❌ | ✅ | ❌ | ✅ |
| Dual-audience | ✅ | ❌ | ❌ | ❌ | ❌ |
| Smart diff | ✅ | ❌ | ❌ | ❌ | ❌ |
| Developer intent | ✅ | ❌ | ❌ | ❌ | ❌ |
| Provider-agnostic | ✅ | N/A | Partial | N/A | Partial |
| Business context | ✅ | ❌ | Partial | ❌ | ❌ |

---

## Roadmap

- VS Code extension for inline context previews
- MCP server integration
- CI/CD pipeline validation
- Python and Go support
- Context file diffing in PR reviews

---

## Research

This tool is backed by a research paper:

> **"Automated Context Generation for AI Code Assistants: An LLM-Powered Framework for Developer Intent Capture and Documentation Automation"**
> Althaf Khan Pattan, Independent Researcher, 2026

---

## Contributing

Contributions are welcome. Open an issue first to discuss what you'd like to change.

```bash
git clone https://github.com/AlthafPattan/contextify-ai.git
cd contextify-ai
npm install
npm test
```

See [docs/how-it-works.md](docs/how-it-works.md) for testing against a real project.

---

## License

MIT

---

**If this tool helps you, consider giving it a ⭐ on [GitHub](https://github.com/AlthafPattan/contextify-ai).**
Every star, fork, and contribution helps keep this project alive.
