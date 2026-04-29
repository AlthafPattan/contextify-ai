# .context.md Format Reference

Each generated `.context.md` has two halves: a human-readable section and a structured AI section.

---

## Human Section

Seven required sections, always in this order:

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

### Content Attribution

Each section carries a `<!-- source: -->` comment:

| Value | Meaning |
| --- | --- |
| `developer` | Content came entirely from the developer message |
| `ai` | Content was entirely AI-inferred from the code |
| `developer+ai` | Section contains both `[dev]` and unmarked bullets |

Bullets prefixed with **[dev]** came from the developer's commit message. Unmarked bullets are AI-inferred from the code. Functional Logic is always `ai` — it reflects only what is structurally present in the code.

---

## AI Section

Structured metadata in a plain code block between `<!-- AI_CONTEXT_START -->` and `<!-- AI_CONTEXT_END -->` markers:

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

---

## Custom System Prompt

If the default format doesn't fit your team's standards, you can supply your own system prompt via the `systemPrompt` config field.

```json
{
  "systemPrompt": "./my-prompt.md"
}
```

The file path is resolved relative to your project root. If the file is not found, contextify falls back to the built-in prompt with a warning.

> **Note:** The built-in tooling checks for `INTENT MISMATCH` in the output and reads the `<!-- AI_CONTEXT_START -->` / `<!-- AI_CONTEXT_END -->` block. If you customize the prompt, preserve these conventions to keep tool integrations working.
