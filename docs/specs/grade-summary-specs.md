# EARS Specs: Grade Summary

Drives: `docs/llds/grade-summary.md`

Status markers: `[ ]` gap · `[x]` implemented · `[D]` deferred

---

## Eligibility And Data Contract

**DFF-GRADE-001** `[x]` → #83
When a post-draft grade summary is generated, the system shall compute the rubric only for drafts whose `drafts.status` is `completed`.

**DFF-GRADE-002** `[x]` → #83
When a completed draft grade summary is generated, the system shall use the draft-pinned player value context to read each drafted player's `dynasty_value`, `adp`, and `position`, and shall pair those values with the player's actual `pick_number` plus the final roster composition for the drafting team.

**DFF-GRADE-003** `[x]` → #83
The grade summary shall return both an overall numeric score on a `0-100` scale and an overall letter grade for each graded team.

---

## Value Over Expected ADP

**DFF-GRADE-010** `[x]` → #83
When the system scores the value-over-expected-ADP dimension for a completed draft team, it shall compare each drafted player's actual `pick_number` against that player's `adp`, where later-than-ADP selections improve the score and earlier-than-ADP selections reduce it.

**DFF-GRADE-011** `[x]` → #83
The system shall weight each player's value-over-expected-ADP contribution by that player's share of the team's drafted `dynasty_value` so higher-impact selections influence the dimension more than low-value late-round picks.

**DFF-GRADE-012** `[x]` → #83
When a drafted player has no `adp`, the system shall exclude that player from the value-over-expected-ADP calculation and shall record a warning indicating incomplete ADP coverage.

**DFF-GRADE-013** `[x]` → #83
When a team has no drafted players with usable `adp`, the system shall assign the value-over-expected-ADP dimension a neutral score rather than failing the full grade summary.

---

## Positional Balance

**DFF-GRADE-020** `[x]` → #83
When the system scores positional balance for a completed draft team, it shall evaluate how the team's drafted `dynasty_value` is distributed across required starter positions `QB`, `RB`, `WR`, and `TE`, normalized by the configured starter count for each required position.

**DFF-GRADE-021** `[x]` → #83
If a completed draft team has zero drafted players at any required starter position, the system shall assign a failing positional-balance outcome for that team.

**DFF-GRADE-022** `[x]` → #83
If more than sixty percent of a completed draft team's drafted players come from a single position group, the system shall apply a severe positional-balance penalty.

---

## Roster Construction

**DFF-GRADE-030** `[x]` → #83
When the system scores roster construction for a completed draft team, it shall evaluate whether the team can fill all dedicated starter slots required by the configured roster settings.

**DFF-GRADE-031** `[x]` → #83
When the configured roster includes `FLEX` or `SF` slots, the roster-construction score shall evaluate whether the team retains enough eligible players after filling dedicated starter slots to cover those flex slots.

**DFF-GRADE-032** `[x]` → #83
The roster-construction score shall include a bench-redundancy check that rewards at least one reserve beyond required starters at `QB` and `TE` when those positions are started, plus at least two reserve bodies across `RB` and `WR`, capped by configured bench size.

**DFF-GRADE-033** `[x]` → #83
When the league configuration omits `FLEX`, `SF`, or meaningful bench depth, the system shall not penalize teams for missing slots that do not exist in that format.

---

## Overall Grade

**DFF-GRADE-040** `[x]` → #83
The system shall compute the overall numeric grade as the weighted sum of three dimensions: value over expected ADP (`50%`), positional balance (`20%`), and roster construction (`30%`).

**DFF-GRADE-041** `[x]` → #83
The system shall map the overall numeric grade to a letter grade using these bands: `85-100 = A`, `70-84 = B`, `55-69 = C`, `40-54 = D`, `0-39 = F`.

---

## Edge Cases

**DFF-GRADE-050** `[x]` → #83
If a draft is incomplete, the system shall not present a post-draft grade summary for that draft.

**DFF-GRADE-051** `[x]` → #83
If a completed draft team has a degenerate all-one-position roster, the system shall still produce an overall grade summary but shall apply failing outcomes to the positional-balance and roster-construction dimensions.

**DFF-GRADE-052** `[x]` → #83
If a completed draft team has zero total drafted `dynasty_value`, the system shall continue grading by using equal pick weights for the value-over-expected-ADP dimension and by scoring the remaining dimensions from roster composition alone.
