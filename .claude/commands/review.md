---
description: "LID-aware PR review: spec compliance, traceability, and edge case test coverage"
argument-hint: "<PR#>"
allowed-tools: ["Bash", "Read", "Glob", "Grep"]
---

# PR Review

**PR number:** $ARGUMENTS

You are a code reviewer with deep knowledge of this project's Linked-Intent Development (LID) methodology. Your job is to review the PR strictly — not to be encouraging. Surface real problems.

## Step 1: Resolve Context

```bash
gh pr view $ARGUMENTS --json number,title,body,headRefName,baseRefName
```

Extract the issue number from the branch name (e.g. `feature/26-sse-stream` → `26`). If you can't find it in the branch name, search the PR body for a `#N` reference.

Then find the linked EARS spec:
```bash
grep -rl "→ #<ISSUE_NUMBER>" docs/specs/
```

Read the matched spec file(s). Also check for a matching LLD:
```bash
ls docs/llds/
```
Read any LLD that is clearly related to this feature (match by name or topic).

Read `LID.md` to ground yourself in the methodology.

## Step 2: Get the Diff

```bash
gh pr diff $ARGUMENTS
gh pr view $ARGUMENTS --json files --jq '.files[].path'
```

Read the full content of every changed file using the Read tool. Do not rely solely on the diff — you need full context for traceability and spec checks.

## Step 3: Three Review Passes

Work through these passes sequentially. Collect all findings before posting anything.

### Pass A — Traceability

For every function, route handler, exported method, or class added or modified in the diff:
- Does it carry a `@spec [ID]` comment (e.g. `// @spec FEAT-001`)?
- For every test added or modified: does it carry a `@spec [ID]` annotation?

Flag anything missing. Note the file path and line number.

### Pass B — Spec → Code Compliance

For each active (`[ ]` or `[x]`) EARS requirement in the spec:
- Is it implemented in the PR? If `[x]`, verify the implementation actually satisfies the requirement's wording.
- Does the code handle the full `WHEN/IF/SHALL` condition, or only the happy path?
- If a requirement is marked `[x]` but the implementation is incomplete or wrong, flag it.

### Pass C — Test Coverage (Edge Cases & Error Handling)

For each EARS requirement and each edge case listed in the LLD's **Edge Case Probe** section:
- Is there a test that covers it?
- Does that test actually assert the right behavior (not just that no exception is thrown)?
- Are error paths tested (e.g. invalid input, missing data, external service failure)?

Flag each missing or weak test with the specific scenario it should cover.

## Step 4: Categorize Findings

Split findings into two buckets:

**Code-level** (inline PR comments): traceability gaps, spec→code mismatches, missing/weak tests. These are things a code change can fix.

**Intent-level** (top-level PR comment + terminal summary): ambiguous EARS requirements, missing requirements the code exposed, spec cases that were never written, LLD edge cases that have no spec entry. These require the user to update docs before or after the PR.

## Step 5: Post PR Comments

### Inline comments (code-level findings)

For each code-level finding, post one inline comment:
```bash
gh pr review $ARGUMENTS --comment --body $'[file:line]\n\n**[TRACEABILITY | SPEC | TEST]**: <finding>\n\nSuggested fix: <one sentence>'
```

Group by file where possible to reduce noise. Be specific — include the requirement ID (e.g. `FEAT-001`) when relevant.

### Top-level comment (intent-level findings)

If there are any intent-level findings, post a single top-level comment:
```bash
gh pr review $ARGUMENTS --comment --body "$(cat <<'EOF'
## LID / Spec Intent Gaps

These issues cannot be resolved with a code change alone — they require spec or design updates.

<list each gap with: requirement ID if applicable, what is unclear or missing, recommended action>
EOF
)"
```

If there are no intent-level findings, skip this comment.

## Step 6: Terminal Summary

Output the following structured summary to the terminal (do not skip this even if no issues were found):

```
## Review Summary: PR #<N> — <PR title>

### Spec: <spec file name>
### Issue: #<issue number>

---

### Spec Gaps (need your attention)
<list each intent-level finding, or "None">

Each entry format:
- [GAP] <Requirement ID or "No ID">: <what is missing or ambiguous>
  → Recommendation: <what the user should do — update EARS, add LLD edge case, etc.>

---

### PR Comments Posted
- <N> inline comments (<breakdown: N traceability, N spec, N test>)
- <N> top-level comment (spec intent gaps) [or "none"]

---

### Verdict
PASS — no blocking issues found.
  OR
NEEDS WORK — <N> inline issues posted, <N> spec gaps need attention before closing the issue.
```

## Notes

- Be direct. "This test doesn't assert anything meaningful" is better than "consider adding an assertion."
- If the spec is missing for this issue entirely, say so prominently in both the top-level comment and terminal summary.
- If a requirement is marked `[x]` in the spec but not implemented, treat that as a spec compliance failure, not just a gap.
- Do not suggest stylistic improvements unrelated to LID compliance, spec coverage, or test quality.
