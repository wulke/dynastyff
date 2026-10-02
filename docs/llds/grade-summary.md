# LLD: Grade Summary

## Context

This component defines the deterministic grading rubric for the post-draft grade summary page. It is intentionally algorithmic and local-first: no Claude call is required to compute the rubric itself. The same rubric is expected to feed any future `GET /drafts/:id/summary` endpoint and any post-draft advisor narration so the UI and AI layers do not invent competing grade logic.

This document is design-only for issue `#83`. No implementation is in scope until a human reviews and approves the rubric.

Drives specs: `docs/specs/grade-summary-specs.md`

Related specs: `docs/specs/advisor-agent-specs.md` (`DFF-ADVISOR-041`)

## Responsibilities

- Compute a numeric `0-100` score for each completed draft team
- Break the overall score into three dimensions: value over expected ADP, positional balance, and roster construction
- Map the numeric score to a letter grade
- Define which persisted draft and ETL fields are required for each dimension
- Handle incomplete drafts and degenerate roster shapes without crashing or producing misleading grades

## Interface / Data Model

### Input data already available

| Source | Fields used | Why it matters |
|---|---|---|
| `drafts` | `id`, `status`, `team_count`, `rounds`, `etl_run_id` | Eligibility gate and draft-size normalization |
| `draft_order` / `picks` | `team_id`, `player_id`, `pick_number`, `round`, `pick_in_round` | Actual draft slot taken by each team |
| Draft-scoped player values | `dynasty_value`, `adp`, `position` | Value scoring and position grouping |
| Final roster composition | drafted players grouped by `team_id` and `position` | Positional balance and construction checks |
| Draft config | roster slot counts (`QB`, `RB`, `WR`, `TE`, `FLEX`, `SF`, `BN`) | Construction expectations and normalization |

### Explicit non-goals for this rubric version

- Age curve scoring
- Trade intent or "won the trade" judgment
- League-specific opponent percentiles
- Claude-authored narrative grading

Those may be layered on later, but this rubric is intentionally restricted to the data contract named in issue `#83`: `dynasty_value`, `adp`, pick slot, and roster composition.

### Output contract

```ts
type GradeDimensionKey =
  | 'valueOverExpectedAdp'
  | 'positionalBalance'
  | 'rosterConstruction';

type DimensionScore = {
  key: GradeDimensionKey;
  score: number;      // integer 0..100
  weight: number;     // percentage weight in overall score
  summary: string;    // short UI-ready explanation
  warnings: string[]; // e.g. ['missing_adp', 'missing_required_position']
};

type TeamGradeSummary = {
  teamId: string;
  overallScore: number;   // integer 0..100
  letterGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: DimensionScore[];
  warnings: string[];
};
```

The summary page should expose both numeric score and letter grade. Numeric score preserves detail; letter grade gives the fast read.

## Logic Flow

### Eligibility gate

1. Read the draft row.
2. If `drafts.status !== 'completed'`, do not compute grades.
3. Build the final team rosters from the persisted completed draft state.
4. Join each drafted player against the draft-pinned player value context so `dynasty_value`, `adp`, and `position` reflect the values that were current when the draft began.

### Dimension 1: Value Over Expected ADP (`50%`)

This dimension answers: "How much market value did this team capture relative to where its players were expected to be drafted?"

For each drafted player with a non-null `adp`:

1. Compute `slotDelta = adp - actualPickNumber`.
   - Positive = the player lasted longer than expected and the drafting team captured a faller.
   - Negative = the team paid above market expectation.
2. Normalize by draft size:
   - `normalizedDelta = clamp(slotDelta / totalPicks, -1, 1)`
3. Convert to a `0-100` per-pick score:
   - `pickScore = 50 + (normalizedDelta * 50)`
4. Weight each pick by its share of the team's total drafted `dynasty_value`:
   - `pickWeight = playerDynastyValue / teamDynastyValueTotal`
   - If `teamDynastyValueTotal <= 0`, fall back to equal pick weights so zero-value teams still receive a stable score.
5. Team dimension score = weighted mean of all `pickScore` values, rounded to the nearest integer.

Rationale:
- ADP provides the market expectation.
- Weighting by `dynasty_value` prevents late-round noise from dominating the grade.
- `50` is intentionally neutral: exactly at-ADP drafts score near the midpoint, with steals pushing upward and reaches pushing downward.

### Dimension 2: Positional Balance (`20%`)

This dimension answers: "Did the team distribute roster value across required positions instead of overconcentrating in one area?"

For each required core position (`QB`, `RB`, `WR`, `TE`) with at least one configured starter:

1. Sum the drafted `dynasty_value` for that position.
2. Divide by the required starters at that position:
   - `valueDensity[position] = totalPositionDynastyValue / requiredStartersAtPosition`
3. Compute the coefficient of variation across all required positions:
   - `cv = stddev(valueDensity[]) / mean(valueDensity[])`
4. Convert to a `0-100` score:
   - `balanceScore = clamp(100 - (cv * 100), 0, 100)`

Hard penalties:
- If a required position has zero drafted players, set `balanceScore` to `0`.
- If more than `60%` of a team's drafted players come from a single position, cap `balanceScore` at `20`.

Rationale:
- This dimension evaluates distribution of roster investment, not just raw headcount.
- Normalizing by required starters keeps a 3-WR league from being judged by the same shape as a 1-WR league.

### Dimension 3: Roster Construction (`30%`)

This dimension answers: "Can the team actually field the configured lineup and still carry a minimally functional bench?"

The score is a 100-point checklist composed of four sub-scores:

1. **Dedicated starter coverage (`40 pts`)**
   - For each required non-flex slot (`QB`, `RB`, `WR`, `TE`), score the fulfilled share of starters.
   - Example: `1/2 RB` starters filled earns half of the RB contribution.
2. **Flex coverage (`20 pts`)**
   - After reserving players for dedicated `RB`, `WR`, and `TE` slots, score the share of configured `FLEX` slots that can still be filled by remaining eligible players.
3. **Superflex coverage (`20 pts`)**
   - After dedicated slots are filled, score the share of configured `SF` slots that can still be filled by remaining eligible players.
   - In practice, a second usable QB is the clearest way to protect this score, but any configured superflex-eligible position may satisfy the slot.
4. **Bench redundancy (`20 pts`)**
   - Award full credit only when the team has:
     - at least one reserve beyond required starters at `QB` when the league starts a QB or superflex,
     - at least one reserve beyond required starters at `TE` when the league starts a TE,
     - at least two reserve bodies across `RB` + `WR`, capped by available bench size.
   - Partial fulfillment receives proportional credit.

Rationale:
- This keeps construction grounded in lineup viability rather than subjective "my favorite roster build" opinions.
- It separates "balanced investment" from "can this roster survive a real lineup card?"

### Overall aggregation

1. Compute all three dimension scores as integers `0-100`.
2. Apply weights:
   - value over expected ADP: `50%`
   - positional balance: `20%`
   - roster construction: `30%`
3. `overallScore = round((valueScore * 0.50) + (balanceScore * 0.20) + (constructionScore * 0.30))`
4. Map numeric score to letter grade using the same grade bands already documented for Season Management:

| Overall score | Letter |
|---|---|
| 85-100 | A |
| 70-84 | B |
| 55-69 | C |
| 40-54 | D |
| 0-39 | F |

Reusing the existing product-wide letter bands avoids conflicting grade semantics between post-draft and season-management views.

## Edge Case Probe

- **Draft is not completed** -> no grade summary is returned; the post-draft grade page remains unavailable until the draft reaches `status = completed`.
- **Team has drafted players with missing `adp`** -> exclude those players from the value-over-expected calculation and append a `missing_adp` warning.
- **Team has no ADP-bearing players at all** -> set value-over-expected score to `50` (neutral) and append `missing_adp`.
- **Team total drafted `dynasty_value` is zero** -> value-over-expected falls back to equal per-pick weights; balance and construction still score normally.
- **Required position has zero drafted players** -> positional balance is forced to `0`; roster construction also loses starter-coverage points for that position.
- **All-one-position roster** -> positional balance collapses to `0`, roster construction collapses toward `0`, and the team may still retain some value score if the picks were good relative to ADP.
- **League has no `FLEX` or `SF` slots** -> the corresponding construction sub-score is treated as automatically satisfied and receives full points so leagues are not penalized for settings they do not use.
- **Bench size is very small** -> bench redundancy expectations are capped by configured bench slots so shallow formats are not penalized like deep-bench formats.
- **A team acquires extra startup slots via trade** -> grade math uses the team's actual drafted picks and final roster only; it does not care how the team obtained those slots.

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Primary value signal | ADP surplus weighted by `dynasty_value` | raw dynasty value sum; unweighted ADP delta | Captures both market timing and importance of the asset taken |
| Balance signal | Value-density variance by position | raw player-count ratios | Value density reflects where meaningful draft capital was allocated, not just bodies |
| Construction signal | Lineup-coverage checklist | subjective archetype labels | Easier to explain, test, and trust |
| Overall output | Numeric score + letter grade | letter only; percentile only | Numeric score preserves detail while letter grade remains glanceable |
| Grade bands | Reuse Season Management bands | invent separate post-draft bands | Avoids product inconsistency |
| Scope | Pure rubric, no narrative | include Claude summary in rubric | Keeps the formula deterministic; narrative can consume the formula later |

## Future Scope

- Add a confidence indicator when too many drafted players are missing ADP.
- Layer in age-curve scoring after a separate data-contract review.
- Add team-vs-league percentile context once all teams in the draft are graded through the same rubric.
