---
name: dev-code-review
description: Use when reviewing a pull request or changeset in any repository — orients the reviewer to the codebase's own standards (AGENTS.md conventions, defensive patterns, quality gates) and applies review-specific checks that code alone cannot show, including intent/interface contracts, lifecycle and concurrency, scope and necessity, model-visible behavior, test strength, and evidence.
---

# Reviewing a Pull Request

**This skill is guidance, not a complete checklist.** Verify and fetch the PR's live base and exact head before reading the diff, then read enough surrounding code to understand the design. Determine which paths and layers the change touches and how the repository's own gates cover them. Prioritize correctness, lifecycle, security, and broken required behavior over style; a short review with one substantiated blocker is better than a list of nits.

## Sources of truth

- The repository's standing rules: `AGENTS.md` / `CONTRIBUTING.md`, package conventions, and any defensive-pattern or testing guidance in `docs/` — read the ones that apply to the diff.
- [dev-prose-standard](../dev-prose-standard/SKILL.md): required coverage and editorial judgment for comments, docs, prompts, and visible strings.
- Design notes / ADRs the change touches: treat disagreement with a recorded decision as a design discussion, not an automatic veto.
- The repository's testing and quality-gate docs: required test tiers and gates.

## Blocking requirements

1. **New prose receives semantic review.** Use [dev-prose-standard](../dev-prose-standard/SKILL.md) to critically review every added or changed Markdown passage, JSDoc, comment, prompt, description, diagnostic, and visible string. Verify required coverage, accuracy, placement, and editorial quality against the owning code or behavior; automated checks do not establish those properties.
2. **Docs match the code.** Config, defaults, errors, wire fields, events, and public behavior update the owning README and JSDoc in the same diff. Comments state non-obvious contracts; flag implementation narration, test walkthroughs, review history, and duplicated rationale for deletion or a link to their one home.
3. **Registrations clean up.** Verify each new registry, subscription, listener, or resource contribution has a corresponding disposal path that the repository's lifecycle tests exercise.
4. **Required evidence exists.** Verify the author ran the relevant local checks for the diff and that CI covers the required matrix; review the semantic gaps neither can detect.

## Manual checks

- **Intent and interface contracts:** trace both sides of every changed interface. Confirm the implementation matches the PR and any design note, including errors, cancellation, ownership, and disposal.
- **Lifecycle and concurrency:** for async setup, callbacks, processes, or teardown, apply the repository's defensive patterns. Check races before publication, cancellation during awaits, independent error reporting, callback containment, ownership before reentry, complete detach cleanup, and quiescent disposal.
- **Capability and consumer fit:** trace every current consumer, then flag consumer-specific behavior leaking into the interface. Flag the inverse too: a new public method on a generic service whose only caller is one internal consumer is an unnecessary API expansion — require a private capability closure handed to that consumer at construction instead.
- **Scope, ownership, and necessity:** map each abstraction, state machine, option, defensive copy, and compatibility path to its current contract, production consumer, and owning module. Challenge unrelated features and speculative generality.
- **Configuration and public choices:** ask what current-consumer evidence or prior art supports each default, public operation set, format, or imported external concept. Require an explicit choice or deferral when that evidence is absent.
- **Model perspective:** inspect the exact prompts, tool schemas, results, and diagnostics the model receives across affected modes (when the product exposes any). Flag concepts outside the task, then verify stable text verbatim and dynamic behavior through snapshots or end-to-end coverage.
- **Enforcement:** follow every denial path to the operation that executes it; exercise direct and alternate callers that can bypass schemas, prompts, facades, wrappers, or listener ordering.
- **Borrowed and derived state:** determine whether each retained value is borrowed or owned under the contract, then trace notifications and every cache, prompt, UI echo, replay, and query view to the documented success point and authoritative source.
- **Bounds cover the final operation:** locate the owner of the complete emitted or retained result, including wrappers and metadata. Probe tiny and exact limits, oversized single chunks, and multibyte text for byte limits.
- **Real entry path:** tests exercise the shipped entry point — the CLI bin, worker, service, or published API — where relevant. A test that hand-mounts internals does not catch loader or wiring failures.
- **Test strength:** assertions fail on the intended regression and verify external state, logs, events, or disposal rather than restating the implementation or trusting an agent's report. Coverage is necessary but not evidence that the scenario is correct.
- **Transcript changes:** editor-visible or model-visible changes update snapshots or explain why no snapshot applies. Review expected-output diffs as behavior changes, not formatting noise.
- **Bilingual changes:** compare meaning and terminology on both sides; a green pairing hash does not prove translation quality.

## Reporting findings

State the defect, location, impact, and evidence. Place a localized defect inline on the tightest relevant diff range; use a PR-level comment for cross-cutting architecture, scope, or review-wide synthesis. Separate blockers from suggestions and omit issues already enforced by a green gate. Use the existing review thread for replies. When receiving review, verify each claim and fix or rebut it on technical grounds without performative agreement.
