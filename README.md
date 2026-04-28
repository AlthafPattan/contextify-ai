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
  }
}
```

You can also use `.contextifyrc.json`, `.contextifyrc.yaml`, `.contextifyrc.js`, or `contextify.config.js`.

---

## How it Works

### 1. Smart Diff — Skip Unnecessary LLM Calls

Not every commit needs a context update. contextify-ai parses your code with Babel, extracts structural elements, hashes them with SHA-256, and compares against the stored hash.

**Triggers regeneration:**
- Added or removed props
- New or deleted exports
- Changed hook usage
- Modified dependencies
- Altered function signatures

**Skips regeneration:**
- Formatting and whitespace
- Variable renames inside functions
- String literal changes
- Comment edits
- CSS class name changes

Result: 50-70% fewer LLM calls.

### 2. Developer-in-the-Loop Intent Capture

When structural changes are detected, the pre-commit hook prompts you interactively:

```
┌─ contextify-ai ─────────────────────────────
│
│  + new  src/components/PaymentForm.tsx
│         +2 props, new dependency (useRetry)
│
│  What changed and why? (enter to skip)
│  > ▊
│
└──────────────────────────────────────────────
```

You can also pass the message directly via the `--message` flag (skips the interactive prompt — useful in scripts or IDE integrations):

```bash
contextify hook --message "added retry logic with exponential backoff, max 3 attempts"
# or short form
contextify hook -m "added retry logic with exponential backoff, max 3 attempts"
```

When a message is provided, the terminal shows it inline instead of prompting:

```
┌─ contextify-ai ─────────────────────────────
│
│  ~ update  src/components/PaymentForm.tsx
│
│  context: added retry logic with exponential backoff, max 3 attempts
│
└──────────────────────────────────────────────
```

Your explanation is sent alongside the code and AST metadata to the LLM. The model uses it as the **primary source** for updating edge cases, business rules, and decision log — then cross-references against the actual code and flags mismatches:

```
┌─ contextify-ai ─────────────────────────────
│
│  ✓ PaymentForm.context.md updated
│
│  ⚠ Intent check:
│    You said: "added retry for tokenization"
│    Found: retryCount increments but no
│    max limit detected in code
│
│  Proceed? (y/n)
│
└──────────────────────────────────────────────
```

### 3. Generated Context File Format

Each `.context.md` has two halves: a human-readable section and a structured AI section.

**Human section** — seven required sections, always in this order:

```markdown
# PaymentForm

## Purpose
<!-- source: developer -->
Exists to isolate all Stripe tokenization logic from the checkout flow,
so payment errors don't propagate upward and corrupt order state.

## Functional Logic
<!-- source: ai -->
* PaymentForm — collects card details, validates client-side, and calls onSubmit with a Stripe token
* CardField (sub-component) — renders the Stripe Elements iframe; replaced by ManualCardEntry if the iframe fails to load
* validateCard (helper) — runs Luhn check and expiry check before tokenization is attempted
* isProcessing state — set to true on submit, disables the button and shows a spinner, reset on success or error
* retryCount state — increments on each tokenization failure; at 2 triggers the alternate card message
* Data flow: props (initialData, onSubmit) → form state → validateCard → Stripe tokenize → onSubmit callback

## Business Context
<!-- source: developer -->
Payment is the final step before order confirmation. Any failure here must be surfaced clearly
without losing the user's cart. The component owns error recovery so the parent checkout page
stays stateless with respect to payment status.

## Use Cases
<!-- source: developer+ai -->
* **[dev]** When a returning user has pre-filled billing data, initialData hydrates the form fields on mount
* When the user submits, card details are validated client-side before any network call is made
* When retryCount reaches 2, an alternate card suggestion message replaces the standard error

## Edge Cases
<!-- source: developer+ai -->
* **[dev]** Expired cards pass format validation but fail at the Stripe tokenization step — the error is caught and retryCount is incremented
* Ad blockers can prevent the Stripe Elements iframe from loading — ManualCardEntry is shown as fallback

## Watch Out
<!-- source: developer+ai -->
* **[dev]** Do not call onSubmit directly — always go through the internal handleSubmit which guards against double-submission
* isProcessing is not reset on unmount; if the parent unmounts mid-flight a setState-on-unmounted-component warning will fire
* ZIP code field visibility depends on customerType from useCheckoutContext — removing that context provider silently hides the field

## Decision Log
<!-- source: developer+ai -->
* **[dev]** Chose Stripe Elements over raw card inputs to keep the form out of PCI scope
* Client-side Luhn check added to reduce unnecessary tokenization round-trips on obviously invalid numbers
```

**AI section** — structured metadata in a plain code block:

```
component:
  name: PaymentForm
  type: component
  framework: react

interface:
  props:
    - name: initialData
      type: Partial<PaymentFormData> | undefined
      optional: true
      description: Pre-filled form data when returning from review
    - name: onSubmit
      type: (token: StripeToken) => Promise<void>
      optional: false
      description: Callback invoked with the tokenized payment data
  returns:
    type: JSX.Element
    description: The rendered payment form

state:
  internal:
    - name: isProcessing
      type: boolean
      controls: Disables submit button and shows loading spinner during tokenization
    - name: retryCount
      type: number
      controls: Switches to alternate card message when value reaches 2
  external:
    - source: useCheckoutContext
      consumes: [customerType, billingAddress]
      purpose: Determines ZIP field visibility and customer billing tier

dependencies:
  internal:
    - path: ../hooks/useStripeElements
      relationship: Manages Stripe iframe lifecycle and exposes tokenize()
  external:
    - package: "@stripe/stripe-js"
      usage: Stripe tokenization API

render_logic:
  conditions:
    - when: Stripe iframe load fails
      renders: ManualCardEntry fallback
    - when: retryCount >= 2
      renders: Alternate card suggestion message
    - when: customerType !== US
      hides: ZIP code field

key_functions:
  - name: handleSubmit
    purpose: Guards against double-submission, runs validation, calls Stripe tokenize, invokes onSubmit
    params: [FormEvent]
    returns: void

testing:
  file: none
  coverage_notes: No tests for the ManualCardEntry fallback path or retryCount reset on success
```

### 4. Hook Ordering — Works with Husky and lint-staged

contextify-ai is designed to run **before** your lint and format steps so that generated `.context.md` files are staged and available to lint-staged before it scans the index.

`contextify init` handles this automatically:

- **Plain `.git/hooks`** — contextify is prepended before any existing hook content
- **Husky** — detected automatically; contextify is prepended to `.husky/pre-commit` before the `lint-staged` call

Resulting hook order:
```sh
#!/bin/sh
npx contextify hook        # 1. generate + stage .context.md files
npx lint-staged            # 2. format/lint all staged files (including .context.md)
```

If a contextify LLM call fails, it logs the error and exits cleanly — it **never blocks the commit**. Lint and format steps always run.

### 5. Commit Message Tagging

Every commit gets tagged automatically:

| Tag | Meaning |
| --- | --- |
| `[context: generated]` | New `.context.md` files created |
| `[context: updated]` | Existing files modified |
| `[context: no-change]` | Smart diff found no structural changes |
| `[context: skipped]` | Developer skipped with `--skip-context` |
| `[context: error]` | LLM call failed (commit is NOT blocked) |

---

## CLI Commands

### `contextify init`

Interactive setup wizard. Creates config, installs git hooks, sets up AI tool integrations.

```bash
contextify init
```

### `contextify generate`

Manually generate `.context.md` files outside of the commit flow.

```bash
# Dry run — see what would be generated without calling the LLM
contextify generate --dry-run

# Generate for a specific file
contextify generate src/components/Button.tsx

# Generate for all files matching your configured scope
contextify generate

# Force regeneration even if smart diff says no changes
contextify generate --force

# Control parallel LLM calls
contextify generate --concurrency 3
```

### `contextify audit`

Check your project's context coverage.

```bash
# Find files missing .context.md
contextify audit

# Also check for stale context files (source changed since last generation)
contextify audit --stale
```

Output:

```
  contextify-ai - audit
  Scanning 24 files...

  Missing .context.md (3):
    - src/components/NewFeature.tsx
    - src/hooks/useAnalytics.ts
    - src/utils/dateFormat.ts

  ─────────────────────────────────
  Total files in scope:  24
  With .context.md:      21
  Missing .context.md:   3
  Coverage:              87.5%
```

### `contextify hook`

Called automatically by git hooks. Not intended to be called directly, but supports flags:

```bash
# Pass a developer message to feed the LLM (skips interactive prompt)
contextify hook --message "refactored auth to use JWT, session edge cases no longer apply"
contextify hook -m "added input validation; empty string now returns 400"

# Skip context generation for this commit
CONTEXTIFY_SKIP=true git commit -m "ci: update deps"
```

### `contextify reset`

Delete `.context.md` files for specific source files, or wipe the whole project. Asks for confirmation unless `--force` is passed.

```bash
# Reset a single file
contextify reset src/components/PaymentForm.tsx

# Reset the entire project (interactive confirmation)
contextify reset

# Skip confirmation (scripts / CI)
contextify reset --force
```

The index at `.contexts/index.md` is updated automatically — deleted if nothing remains, trimmed otherwise.

### `contextify regen`

Force-regenerate `.context.md` files. Unlike a plain reset + generate, this passes the **existing** `.context.md` back to the LLM so it can preserve edge cases and conditions that are still accurate while updating what has changed.

```bash
# Regenerate a single file
contextify regen src/components/PaymentForm.tsx

# Regenerate everything
contextify regen

# With a message to guide the LLM on what to focus on
contextify regen -m "switched from session tokens to JWT across the board"

# Control parallel LLM calls
contextify regen --concurrency 3
```

**Full refresh workflow** (when you want to start completely from scratch):

```bash
contextify reset --force   # delete all .context.md
contextify regen -m "..."  # regenerate with no prior context, guided by your message
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

A project-wide index is auto-generated at `.contexts/index.md` — a table of contents listing every context file, categorized by type (component, hook, util, context, type).

---

## Testing Locally

```bash
git clone https://github.com/AlthafPattan/contextify-ai.git
cd contextify-ai
npm install
npm test
```

To test against a real project:

```bash
# Link the package globally
npm link

# Create a test project
mkdir ~/test-project && cd ~/test-project
git init && npm init -y
mkdir -p src/components

# Add a component
cat > src/components/Button.tsx << 'EOF'
import React, { useState } from 'react';

interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary';
  onClick: () => void;
}

const Button: React.FC<ButtonProps> = ({ label, variant = 'primary', onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <button className={`btn-${variant}`} onClick={onClick}>{label}</button>
  );
};

export default Button;
EOF

# Initialize and generate
contextify init
contextify generate --dry-run
contextify generate src/components/Button.tsx
cat src/components/Button.context.md
```

---

## Why Colocation

The `.context.md` file sits next to the component it describes — same convention as `.test.tsx`, `.module.css`, and `.stories.tsx`.

AI tools with file system access discover these files without any integration work. Claude Code reads `PaymentForm.tsx`, checks the same directory for `PaymentForm.context.md`, parses the YAML, and understands the props, state, dependencies, and business rules before writing a single line.

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

---

## License

MIT

---

**If this tool helps you, consider giving it a ⭐ on [GitHub](https://github.com/AlthafPattan/contextify-ai).**
Every star, fork, and contribution helps keep this project alive.
