---
name: dev-doc-standards
description: Use when writing, moving, reviewing, or auditing documentation in any repository — choosing hierarchy and detail, separating tutorials from references, checking tutorial progression, trimming doc slop, or for requests like "improve the docs", "audit the docs", "where should this be documented", or "this doc is too long".
---

# Applying a Documentation Standard

The documentation rules come from the repository's own standards (AGENTS.md / CONTRIBUTING.md / docs/ conventions). This workflow covers placement, corpus audits, budgets, and validation across Markdown, JSDoc, and code comments. It is guidance, not a script; use [dev-prose-standard](../dev-prose-standard/SKILL.md) for required coverage and editorial judgment, and never treat length alone as a defect.

## Sources of truth (read, don't re-summarize)

- The repository's documentation standard — hierarchy, tutorial/reference forms, taxonomy, budgets, and slop checklist.
- The repository's design-note convention — when a decision earns a note/ADR, how to file it, and what goes inside one (header block, per-lifecycle skeleton, Alternatives-considered mandate); and its postmortem convention — when an incident earns a postmortem.
- The bilingual pairing rules, if the repository keeps paired docs — editing either side of a pair obligates the counterpart in the same change.
- The standing engineering orders whose budget discipline this standard protects.

## Review structure before prose

Apply the standard's authoring order to every human-facing document in scope. Do not apply this structural pass to design notes. Classify a postmortem as a reference scoped to one incident; preserve its required chronological evidence without treating chronology as a teaching sequence.

1. Locate the document in the repository and navigation trees. State its own subject and identify its direct children.
2. Set the permitted level of detail. Keep full detail about the document's subject, summarize direct children by purpose, responsibility, and high-level behavior, and move deeper explanations to their owning descendants with links. Treat test infrastructure as descendant-owned unless it is the document's subject.
3. Classify the document from its intended use, not its path or title. A tutorial must lead through ordered work to an observable outcome; a reference must support lookup within an explicit scope without requiring sequential reading.
4. For a tutorial, privately classify the starting reader and concepts as beginner, intermediate, or advanced. Trace each concept to its prerequisites, reorder premature material, and move optional advanced detail to a later tutorial or reference.
5. Split substantial mixed forms. Put a small secondary form in a clearly labeled section.

Then check constraints that make placement expensive or wrong:

- Paired docs cost a counterpart update and a consistency re-record on every edit — prefer an unpaired home for content that will churn.
- Generated catalogs are never hand-edited; if the fact belongs there, change the generator's source.
- Before renaming or moving any doc, grep for inbound references: link checkers catch Markdown link targets and fragment anchors onto Markdown files; citations from code comments or string literals still need a manual grep when their output never reaches gate-scanned Markdown.
- A move is atomic: remove from the old home, add to the new home, and fix every inbound link in the same change.

## Audit the corpus

After the structural pass, hunt the standard's slop checklist with the cheapest probes first. Establish the exact scope of the outgoing change (committed and dirty paths) before applying semantic judgment; after a retarget or base merge, re-audit prose introduced by the new base.

1. Measure: list any doc-budget violations the repository defines, then `git ls-files '*.md' ':(exclude)vendor/**' | xargs wc -w | sort -rn | head -30` to spot unbudgeted outliers.
2. Hunt reasoning-transcript leakage — narrated history, dead design-session citations, review choreography, control-flow narration, test walkthroughs — with [dev-trim-cot-leakage](../dev-trim-cot-leakage/SKILL.md), which defines the taxonomy and the rules for what to keep or delete. Preserve only a non-obvious contract or durable rationale; the same rationale repeated beside sibling methods keeps one home.
3. Hunt duplication by grepping distinctive phrases. Keep one home and replace other copies with links.
4. Replace hand-written catalogs, test/status inventories, and JSDoc restatements with the authoritative tree, script, or generated reference.
5. In implemented design notes, remove migration plans, acceptance-task checklists, and future-tense spec language. Keep concise verification contracts that identify the behaviors and tiers pinning the shipped decision, plus named coverage gaps.
6. If removing prose changes a promised behavior rather than its explanation, use a proposed design note first (follow [dev-find-simplifications](../dev-find-simplifications/SKILL.md)).

Keep every load-bearing rule, preferably as one to three lines plus a link to its rationale. Cut stories, duplicates, status notes, and the path used to derive the rule. Do not create a new explanation merely to relocate disposable reasoning.

## When the doc-budget gate goes red

Apply the repository's ordered relocate-condense-raise policy; this skill only supplies the workflow probes above.

## Validation and PR hygiene

Run the repository's doc gates (doc-sync equivalent), lint, and `git diff --check`; JSDoc changes may regenerate catalogs. If a paired doc changed, follow the pairing workflow ([dev-translate-docs](../dev-translate-docs/SKILL.md) for the extended path) and re-record the pair. The PR body should give word deltas, explain any deliberately long exception, and list checks.
