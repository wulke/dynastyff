#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="${1:-claude}"

issues_json=$(gh issue list --state open --json number,title,labels,body --limit 100)
[[ -z "$issues_json" || "$issues_json" == "[]" ]] && { echo "Error: No open issues found." >&2; exit 1; }

open_numbers=$(echo "$issues_json" | jq '[.[].number]')

# Filter label-blocked issues, sort by priority
candidates=$(echo "$issues_json" | jq -c '
  map(select(.labels | map(.name) | any(. == "blocked" or . == "needs-info" or . == "needs-triage" or . == "in-progress") | not)) |
  sort_by(if (.labels | map(.name) | any(. == "bug")) then 0 elif (.labels | map(.name) | any(. == "ready-for-agent")) then 1 else 2 end) | .[]')

# Walk sorted candidates; pick first with no open dependencies
selected=""
while IFS= read -r issue; do
  body=$(echo "$issue" | jq -r '.body')
  deps=$(echo "$body" | awk 'tolower($0) ~ /^## *(blocked by|depends on)/{f=1;next} /^##/{f=0} f{print}' | grep -oE '#[0-9]+' | tr -d '#' || true)
  has_open_dep=false
  for dep in $deps; do
    echo "$open_numbers" | jq -e "contains([$dep])" > /dev/null 2>&1 && { has_open_dep=true; break; }
  done
  $has_open_dep || { selected="$issue"; break; }
done <<< "$candidates"

[[ -z "$selected" ]] && { echo "Error: No actionable issues found." >&2; exit 1; }

echo "Working on #$(echo "$selected" | jq -r '.number'): $(echo "$selected" | jq -r '.title')"

commits=$(git log -n 5 --format="[%H] %ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
all_issues=$(echo "$issues_json" | jq -r '.[] | "Issue #\(.number): \(.title)\nLabels: \(.labels | map(.name) | join(", "))\n\(.body)\n---"')
prompt=$(cat "$SCRIPT_DIR/prompt.md")

context="$prompt

## Recent Commits (last 5)
$commits

## All Open Issues
$all_issues

## Your Task
Work on and close issue #$(echo "$selected" | jq -r '.number'): $(echo "$selected" | jq -r '.title')

$(echo "$selected" | jq -r '.body')"

if [[ "$AGENT" == "codex" ]]; then
  codex "$context"
else
  claude --permission-mode acceptEdits -p "$context"
fi
