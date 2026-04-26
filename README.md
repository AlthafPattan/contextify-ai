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
    "src/**/*.tsx",
    "src/**/*.ts",
    "src/**/*.jsx",
    "src/**/*.js"
  ],
  "exclude": [
    "**/*.test.*",
    "**/*.spec.*",
    "**/*.stories.*",
    "**/index.ts",
    "**/index.tsx",
    "**/*.d.ts"
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

When structural changes are detected, the pre-commit hook prompts you:

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

Your explanation gets sent alongside the code diff and AST metadata to the LLM. The model cross-references your stated intent against the actual code and flags mismatches:

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

### 3. Dual-Section Context File

Each `.context.md` has a human section and an AI section:

**Human section (the "why"):**

```markdown
# PaymentForm

## Purpose
Handles credit card payment submission with client-side validation
and Stripe tokenization.

## Business Rules
- Card validation must complete before submit enables
- Two failed tokenizations triggers "try another card" message
- ZIP code required for US addresses only

## Edge Cases
- Expired cards pass format validation but fail tokenization
- Ad blockers can prevent Stripe Elements iframe from loading

## Decision Log
- Chose Stripe Elements over raw inputs for PCI compliance
- Client-side Luhn over API validation to reduce round-trips
```

**AI section (the "what"):**

```yaml
component:
  name: PaymentForm
  type: component
  framework: react

interface:
  props:
    - name: initialData
      type: "Partial<PaymentFormData> | undefined"
      optional: true
      description: "Pre-filled form data when returning from review"
    - name: onSubmit
      type: "(token: StripeToken) => Promise<void>"
      optional: false
      description: "Callback with tokenized payment data"

state:
  internal:
    - name: isProcessing
      type: boolean
      controls: "Submit button disabled state and loading indicator"
    - name: retryCount
      type: number
      controls: "Switches to alternate card message at count >= 2"

  external:
    - source: useCheckoutContext
      consumes: [customerType, billingAddress]
      purpose: "Determines ZIP requirement and customer tier"

dependencies:
  internal:
    - path: ../hooks/useStripeElements
      relationship: "Manages Stripe iframe lifecycle"
  external:
    - package: "@stripe/stripe-js"

render_logic:
  conditions:
    - when: "Stripe iframe load fails"
      renders: ManualCardEntry
    - when: "retryCount >= 2"
      renders: "Alternate card suggestion"
    - when: "customerType !== 'US'"
      hides: "ZIP code field"
```

### 4. Commit Message Tagging

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
# Skip context generation for this commit
git commit -m "fix: typo" --skip-context

# Or via environment variable (useful in CI)
CONTEXTIFY_SKIP=true git commit -m "ci: update deps"
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

> **"Contextify-AI: An LLM-Powered Framework for Automated, Dual-Audience Context File Generation in Modern Software Projects"**
> Althaf Khan Pattan, Independent Researcher, 2025
> [arXiv: cs.SE](https://arxiv.org/)

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
