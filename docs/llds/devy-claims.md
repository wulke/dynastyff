# LLD: Devy Claims

Drives specs: `docs/specs/devy-claims-specs.md`

## Context

In devy-style Sleeper leagues ("I Love College"), taxi squads hold NFL placeholder players and the commissioner sets a league-wide nickname on each placeholder (`roster.metadata["p_nick_<playerId>"]`) naming the actual college player it represents. The Sleeper sync already stores taxi slots in `sleeper_rosters` but discards `roster.metadata`, so claims are invisible in the app. A standalone script (`scripts/devy-claims.mjs`) extracts them ad hoc; this feature brings claims into the sync pipeline and the Season Management UI.

## Data Model

### `sleeper_rosters` — new nullable column

```sql
devy_name TEXT  -- NULL unless the row is a taxi slot whose roster metadata carried a p_nick_ nickname
```

Defined in `src/db/schema.ts` (`sleeperRosters`); applied via migration `drizzle/0002_add_sleeper_roster_devy_name.sql` (`npm run db:migrate` upgrades existing databases; `npm run db:init` builds fresh ones already current). No new tables.

A devy claim is a `sleeper_rosters` row with `slot_type = 'taxi' AND devy_name IS NOT NULL`.

### Read-time devy-board match

```ts
type DevyMatch = {
  matched: boolean;
  position: string | null;   // from devy_players
  school: string | null;
  draftYear: number | null;
  dynastyValue: number | null; // devy_players.value_superflex
};
```

Claim names are matched to `devy_players` by normalized name (reuse `normalizePlayerName` from `src/etl/player-matching.ts` plus `player-aliases.json` alias families, with quote variants (' ’ ‘ `) stripped — commissioner nicknames are free text). Matching happens at request time so board refreshes (`npm run etl:devy`) are reflected without re-sync; unmatched claims still display their name. Roster-overview entries carry `devyName` plus a nested `devyMatch` (null for non-claim rows) so the devy fields never collide with the placeholder player's own fields.

## Logic Flow

### Sync (`src/etl/sleeper/sync.ts`)

1. `SleeperRosterPayload` gains `metadata?: Record<string, unknown>`.
2. When building slot rows, a row whose slot resolves to `taxi` looks up `metadata["p_nick_" + sleeperPlayerId]`.
3. If the value is a non-empty string, it is stored (trimmed) as `devy_name`; otherwise `NULL`.
4. Nicknames on non-taxi slots are ignored. The wholesale per-league delete/replace of `sleeper_rosters` on each sync already keeps claims in step with the real roster.

### Season API (`src/server/season-routes.ts`, helper `src/server/devy-claims.ts`)

- **Roster overview:** each roster entry gains `devyName: string | null` and, when `devyName` is present and matches the board, the `DevyMatch` fields. Placeholder (NFL) fields remain untouched.
- **New route `GET /season/:league_id/devy/claims`:**
  ```json
  {
    "season": "2026",
    "claims": [{ "rosterId": 3, "teamName": "wulke", "devyName": "Jadan Baugh",
                 "devyMatch": { "matched": true, "position": "RB", "school": "Florida Gators",
                                 "draftYear": 2027, "dynastyValue": 6364 } }],
    "available": [{ "name": "Kewan Lacy", "position": "RB", "school": "Ole Miss Rebels",
                    "draftYear": 2027, "dynastyValue": 6651 }],
    "lastSyncedAt": "2026-10-10T…"
  }
  ```
  - `claims`: every `sleeper_rosters` row with `slot_type='taxi' AND devy_name IS NOT NULL`, joined to `sleeper_teams` for team names, sorted by team name then value/name. `devyMatch` carries the read-time board match (`matched: false` + nulls when the name is not on the board).
  - `available`: `devy_players` rows whose normalized name is not in the claimed set, sorted by `value_superflex` desc. Returned in full (board is ~100 rows); the UI filters by draft year, defaulting to `season + 1`.
  - Unknown league → 404; league with no synced rosters → empty arrays, not an error.

### UI (`src/ui/components/MyTeamSection.tsx`)

- **Roster Overview taxi rows:** when `devyName` is set, render the devy name as the primary label (devy position badge when matched) with the placeholder NFL name as muted secondary text (`via <placeholder>`). Dynasty value column shows the devy-board value when matched. Non-devy rows are unchanged.
- **Devy Claims panel:** rendered after the roster overview for the selected league. Two sections: "Claimed" — one row per claim across all teams (team, devy name, position, school, draft year, value); "Available" — unclaimed board rows with a draft-year filter defaulted to the next draft class (current season + 1). Hidden entirely when the league has zero claims.

## Edge Case Probe

- **Nickname on a non-taxi player** → ignored; only taxi slots claim devy players in this league convention.
- **Empty/whitespace nickname** → stored as `NULL`.
- **Claim name not on the `devy_players` board** (board covers ~101 players; deep stashes are missing) → `matched: false`, name still displayed with null position/school/value; appears in `claims`, excluded from nothing else.
- **Two managers claim the same devy name** → both rows surface independently (Sleeper is the source of truth); `available` excludes the name once claimed by anyone.
- **`etl:devy` never run / empty `devy_players`** → all claims `matched: false`, `available` empty; panel still lists claims.
- **League with no claims (no taxi nicknames anywhere)** → route returns empty `claims`; UI hides the panel; Roster Overview unchanged.
- **Existing DBs created before this feature** → schema comes up fresh on `npm run db:init` + `npm run etl`; sync re-populates `devy_name` on the next run.
- **Placeholder players already in `players` table** (e.g. a devy league whose taxi placeholders are real rookies with values) → roster entry keeps its NFL-derived fields; `devyName` is additive and never overwrites matched-player data.
