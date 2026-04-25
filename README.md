<p align="center">
  <img src="https://img.shields.io/npm/v/contextify-ai?style=flat-square&color=0F3460" alt="npm version" />
  <img src="https://img.shields.io/npm/dm/contextify-ai?style=flat-square&color=0A7E8C" alt="npm downloads" />
  <img src="https://img.shields.io/github/stars/AlthafPattan/contextify-ai?style=flat-square&color=E76F51" alt="GitHub stars" />
  <img src="https://img.shields.io/github/license/AlthafPattan/contextify-ai?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs welcome" />
</p>

<h1 align="center">contextify-ai</h1>

<p align="center">
  <strong>AI tools read your code. They can't read your mind.</strong><br/>
  Auto-generate <code>.context.md</code> files at commit time so both humans and AI tools understand your components.
</p>

---

## What it does

**contextify-ai** hooks into your git commit workflow, analyzes changed components using AST parsing, asks what you intended, and generates a structured `.context.md` file next to each component.

One file. Two audiences.

- **Top half** - prose for humans: purpose, business rules, edge cases, design decisions
- **Bottom half** - YAML for AI tools: props, state, dependencies, render conditions

```
src/
  PaymentForm/
    PaymentForm.tsx
    PaymentForm.test.tsx
    PaymentForm.module.css
    PaymentForm.context.md    ← generated
```

AI tools like Claude Code, Cursor, and Copilot pick up `.context.md` files automatically. No plugins. No configuration. Just convention.

---

## Install

```bash
npm install contextify-ai --save-dev
```

## Setup

```bash
npx contextify-ai init
```

This does three things:
1. Installs a git pre-commit hook
2. Creates a `.contextifyrc` config file
3. Prompts you to select an LLM provider

---

## Configuration

```json
// .contextifyrc
{
  "provider": "claude",
  "model": "claude-sonnet-4-20250514",
  "include": ["src/**/*.{tsx,jsx,ts,js}"],
  "exclude": ["**/*.test.*", "**/*.stories.*"],
  "concurrency": 3,
  "interactive": true
}
```

### Supported providers

| Provider | Config value | Cost | Notes |
|----------|-------------|------|-------|
| Claude | `claude` | Paid | Best quality output |
| GPT-4o | `openai` | Paid | Fast, reliable |
| GitHub Models | `github` | Free | Great for open source |
| Google Gemini | `gemini` | Free tier | Good free option |
| Ollama | `ollama` | Free | Local, fully private |

Set your API key via environment variable:

```bash
export CONTEXTIFY_API_KEY=your-key-here

# For Ollama, set the host instead
export OLLAMA_HOST=http://localhost:11434
```

---

## How it works

### 1. Smart-diff catches cosmetic changes

Not every commit needs a context file update. Renaming a variable or fixing whitespace doesn't change what the component does.

contextify-ai parses your code with Babel, extracts structural elements (exports, props, hooks, imports, function signatures), hashes them with SHA-256, and compares against the stored hash.

**Triggers regeneration:**
- Added or removed props
- New or deleted exports
- Changed hook dependencies
- Modified imports
- Altered function signatures

**Skips regeneration:**
- Formatting and whitespace
- Variable renames inside functions
- String literal changes
- Comment edits

Result: 50-70% fewer LLM API calls.

### 2. Developer-in-the-loop intent capture

When a structural change is detected, the tool asks:

```
contextify-ai: PaymentForm.tsx has structural changes.
> What changed and why?
```

Your response gets sent alongside the code diff and AST metadata to the LLM. The model cross-references your stated intent against actual changes and flags mismatches:

```
⚠ Warning: detected changes not mentioned in your description:
  - New prop: maxRetries (number, default: 3)
  Proceed? [y/n/revise]
```

### 3. Dual-section context file

The generated `.context.md` contains:

```markdown
# PaymentForm

## Purpose
Handles credit card payment submission with real-time validation.

## Business Rules
- Luhn validation runs on blur, not on keystroke
- Submit button disables during processing to prevent double-charges

## Edge Cases
- Expired cards show inline error, do not clear form
- Network timeout after 30s triggers retry prompt

## Decision Log
- Client-side Luhn over API validation to reduce round-trips
- Controlled inputs to support save-draft feature

---
```

```yaml
component:
  name: PaymentForm
  type: functional
  framework: react

interface:
  props:
    - name: amount
      type: number
      required: true
    - name: onSuccess
      type: "(txId: string) => void"
      required: true

state:
  internal:
    - isProcessing: boolean
    - error: string | null

dependencies:
  external:
    - payment-gateway-sdk

render_logic:
  conditions:
    - idle: "Default form state"
    - processing: "API call in flight"
    - error: "Inline error displayed"
```

### 4. Commit message tagging

Every commit gets tagged for visibility:

| Tag | Meaning |
|-----|---------|
| `[context: generated]` | New context file created |
| `[context: updated]` | Existing file regenerated |
| `[context: no-change]` | Smart-diff found no structural change |
| `[context: skipped]` | Component excluded by config |

---

## CLI Commands

```bash
# Initialize in a project
npx contextify-ai init

# Generate context for all components (bypasses smart-diff)
npx contextify-ai generate

# Generate for a specific file
npx contextify-ai generate src/PaymentForm/PaymentForm.tsx

# Check which files need context updates
npx contextify-ai status

# Generate project-wide index of all context files
npx contextify-ai index
```

---

## Why colocation

The `.context.md` file sits next to the component it describes - same convention as `.test.js`, `.module.css`, and `.stories.js`.

AI tools with file system access discover these files without any integration work. Claude Code reads `PaymentForm.tsx`, checks the same directory for `PaymentForm.context.md`, parses the YAML, and knows the props, state, dependencies, and business rules before writing a single line.

Convention over configuration.

---

## vs. other tools

| Feature | contextify-ai | Repomix | code-contextify | JSDoc | AI commit generators |
|---------|:---:|:---:|:---:|:---:|:---:|
| Per-component | ✅ | ❌ | ❌ | ✅ | ❌ |
| Commit-hooked | ✅ | ❌ | ❌ | ❌ | ✅ |
| LLM-powered | ✅ | ❌ | ✅ | ❌ | ✅ |
| Dual-audience | ✅ | ❌ | ❌ | ❌ | ❌ |
| Smart-diff | ✅ | ❌ | ❌ | ❌ | ❌ |
| Developer intent | ✅ | ❌ | ❌ | ❌ | ❌ |
| Provider-agnostic | ✅ | N/A | Partial | N/A | Partial |
| Business context | ✅ | ❌ | Partial | ❌ | ❌ |

---

## Roadmap

- [ ] VS Code extension for inline context previews
- [ ] MCP server integration
- [ ] CI/CD pipeline validation
- [ ] Python and Go support
- [ ] Context file diffing in PR reviews

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

## Research

This tool is backed by a peer-reviewed research paper:

> **"Contextify-AI: An LLM-Powered Framework for Automated, Dual-Audience Context File Generation in Modern Software Projects"**
> Althaf Khan Pattan, Independent Researcher, 2025
> [arXiv: cs.SE](https://arxiv.org/)

---

## License

MIT

---

<p align="center">
  <strong>If this tool helps you, consider giving it a ⭐ on <a href="https://github.com/AlthafPattan/contextify-ai">GitHub</a>.</strong><br/>
  Every star, fork, and contribution helps keep this project alive.
</p>