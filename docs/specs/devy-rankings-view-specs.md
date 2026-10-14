# Specs: Devy Rankings View (Ownership + Notes)

| ID | Requirement | Status |
|---|---|---|
| DFF-DVR-001 | WHEN the devy ownership endpoint is requested THE API SHALL return every `devy_players` row claimed in the league mapped by player id to the owning team's name, resolved from taxi `devy_name` claims by normalized name (alias families included) | [x] → #222 |
| DFF-DVR-002 | WHEN two teams claim the same normalized devy name THE API SHALL resolve ownership to the lexicographically first team name | [x] → #222 |
| DFF-DVR-003 | WHEN the requested league is synced but has no devy claims THE ownership endpoint SHALL return an empty ownership mapping; IF the league context cannot be assembled (unknown, unconnected, or insufficient synced rosters) THE endpoint SHALL respond with the shared season-route context error | [x] → #222 |
| DFF-DVR-004 | WHEN the devy rankings view is rendered with ownership data THE UI SHALL display the owning Sleeper team's name on each claimed player's row | [x] → #222 |
| DFF-DVR-005 | WHEN the devy rankings view is rendered with ownership data IF a devy player is not claimed by any team THE UI SHALL display an explicit unowned indicator on that row | [x] → #222 |
| DFF-DVR-006 | WHEN the devy rankings view is rendered without ownership data (no connected league or failed load) THE UI SHALL display an unknown indicator on every row rather than a false unowned state | [x] → #222 |
| DFF-DVR-007 | WHEN the devy rankings view is rendered without ownership or notes props THE UI SHALL render the rankings table without the owner and notes columns | [x] → #222 |
| DFF-DVR-008 | WHEN a devy player row's notes button is activated THE UI SHALL open a notes modal for that player showing any saved note | [x] → #222 |
| DFF-DVR-009 | WHEN a note is saved from the modal THE API SHALL persist it keyed by devy player id with an updated-at timestamp and THE UI SHALL update the row's notes indicator | [x] → #222 |
| DFF-DVR-010 | WHEN a devy player has a saved note THE UI SHALL render that row's notes button in a highlighted state | [x] → #222 |
| DFF-DVR-011 | WHEN a saved note is deleted or saved empty THE API SHALL remove the stored note and THE UI SHALL clear the row's highlighted state | [x] → #222 |
| DFF-DVR-012 | WHEN the notes list endpoint is requested THE API SHALL return every stored devy note keyed by player id | [x] → #222 |
| DFF-DVR-013 | WHEN a note save request carries a non-string note or blank player id THE API SHALL reject it with a 400 response | [x] → #222 |
| DFF-DVR-014 | WHEN the notes modal save is activated IF no save handler is wired THE UI SHALL NOT render the notes button (feature off for snapshot-fed views) | [x] → #222 |
| DFF-DVR-015 | WHEN saving a note from the modal fails THE UI SHALL keep the modal open with the draft intact and display an inline error message | [x] |
