# Specs: Devy Claims

| ID | Requirement | Status |
|---|---|---|
| DFF-DVC-001 | WHEN the Sleeper sync processes a roster IF a taxi-squad player has a non-empty `p_nick_` nickname in the roster metadata THE sync SHALL persist the trimmed nickname as `devy_name` on that `sleeper_rosters` row | [x] |
| DFF-DVC-002 | WHEN a roster player is not on the taxi squad OR has no `p_nick_` nickname THE sync SHALL store `devy_name` as NULL on that row | [x] |
| DFF-DVC-003 | WHEN a devy claim name matches a `devy_players` row by normalized name (including alias families) THE season API SHALL attach that row's position, school, draft year, and superflex value to the claim with `matched: true` | [x] |
| DFF-DVC-004 | WHEN a devy claim name does not match any `devy_players` row THE season API SHALL return the claim with `matched: false` and null position/school/draft-year/value | [x] |
| DFF-DVC-005 | WHEN the season roster overview is requested THE API SHALL include `devyName` and the devy-board match metadata on each roster entry | [x] |
| DFF-DVC-006 | WHEN the devy claims endpoint is requested THE API SHALL return every claim in the league (with owning team names) and every `devy_players` row not claimed by any team, ranked by superflex value | [x] |
| DFF-DVC-007 | WHEN the requested league is synced but has no devy claims THE devy claims endpoint SHALL return an empty claims list and the full unclaimed board as the available list; IF the league context cannot be assembled (unknown, unconnected, or insufficient synced rosters) THE endpoint SHALL respond with the shared season-route context error | [x] |
| DFF-DVC-008 | WHEN rendering a taxi roster row that has a `devy_name` THE UI SHALL display the devy claim name as the primary label with the placeholder NFL name as muted secondary text | [x] |
| DFF-DVC-009 | WHEN rendering the My Team section for a league that has at least one devy claim THE UI SHALL show a Devy Claims panel listing all teams' claims and the unclaimed board with a draft-year filter | [x] |
| DFF-DVC-010 | WHEN the league has no devy claims THE UI SHALL NOT render the Devy Claims panel and roster rows SHALL render unchanged | [x] |
| DFF-DVC-011 | WHEN the season roster overview contains devy claims THE API SHALL load the devy board matcher at most once per request | [x] |
| DFF-DVC-012 | WHEN the devy claims endpoint returns claims THE API SHALL include each claim's Sleeper placeholder player id so claims are uniquely identifiable even when a roster repeats a devy name | [x] |
