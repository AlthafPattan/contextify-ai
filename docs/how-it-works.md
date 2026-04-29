# How contextify-ai Works

---

## 1. Smart Diff — Skip Unnecessary LLM Calls

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

Result: 50–70% fewer LLM calls on active codebases.

---

## 2. Developer Intent Capture

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

You can also pass the message directly via `--message` (skips the interactive prompt — useful in scripts or IDE integrations):

```bash
contextify hook --message "added retry logic with exponential backoff, max 3 attempts"
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

Your explanation is sent alongside the code and AST metadata to the LLM as the **primary source** for updating edge cases, business rules, and the decision log. The model cross-references your message against the actual code and flags mismatches:

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

---

## 3. Hook Ordering — Works with Husky and lint-staged

contextify-ai is designed to run **before** your lint and format steps so that generated `.context.md` files are staged and available to lint-staged.

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

---

## 4. Commit Message Tagging

Every commit gets tagged automatically:

| Tag | Meaning |
| --- | --- |
| `[context: generated]` | New `.context.md` files created |
| `[context: updated]` | Existing files modified |
| `[context: no-change]` | Smart diff found no structural changes |
| `[context: skipped]` | Developer skipped with `--skip-context` |
| `[context: error]` | LLM call failed (commit is NOT blocked) |

---

## 5. Testing Locally

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
