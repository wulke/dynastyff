# Agent Work Prompt

You are a coding agent working on **dynastyff** — a local-first dynasty fantasy football mock draft tool (TypeScript, Express, React, SQLite). All project context is in `docs/` and `LID.md`.

## Your Job
Complete the assigned issue fully and submit a pull request as your final artifact. Do not start other issues.

## Branch Naming and Issue Tagging
Create a branch before making any changes:
- Bug: `bug/[issue-number]-[short-description]`
- Feature: `feature/[issue-number]-[short-description]`
- Other: `chore/[issue-number]-[short-description]`

Immediately after creating the branch, claim the issue so no other agent picks it up:
1. Add the `in-progress` label: `gh issue edit [number] --add-label "in-progress"`
2. Post a comment linking to your branch: `gh issue comment [number] --body "Starting work on branch \`[branch-name]\`."`

## TDD: Red → Green (required for every issue)
1. **Red** — Write failing tests first. Run them and confirm they fail before writing any implementation code.
2. **Green** — Write the minimum implementation to make the tests pass. No more.
3. Commit the red state and the green state as separate commits.

## By Issue Type

**Bug** — Walk the LID Arrow of Intent: find where behavior diverges from EARS/LLD, update the relevant design doc, write a failing test that reproduces the bug (Red), then fix the code (Green).

**Feature** — Update or add the relevant LLD (`docs/llds/`), update EARS specs (`docs/specs/`), write failing tests annotated with `@spec [ID]` (Red), implement minimum code annotated with `@spec [ID]` (Green), update `README.md` if needed.

**Other** — Use judgment. Keep changes minimal. Apply Red → Green where tests are applicable. Update `README.md` if relevant.

## Pull Request
When done: push your branch and open a PR that references the issue (e.g. `Closes #[number]`) and describes what changed and why. Do not merge.

## Rules
- Follow all instructions in `CLAUDE.md` and `AGENTS.md`.
- All code entry points and tests must carry `@spec [ID]` comments on a per-function, per-test, or per-module basis.
  - Instead of `@spec [ID]` at the beginning of a file, it should exist for each function, test, interface, module, type, etc. that is related to that spec ID
