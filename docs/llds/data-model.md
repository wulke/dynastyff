# LLD: Data Model

## Context

The data model is the foundation all other components build on. It covers two concerns: the static player dataset (populated by the separate ETL feature) and the live draft session state (owned by the draft engine). All draft state is continuously persisted to SQLite — no mid-draft resume is supported, but full history is retained for post-draft review and analysis.

Drives specs: `docs/specs/data-model-specs.md`

## Schema Lifecycle

`npm run db:init` is an explicit destructive fresh-database operation. It removes the target SQLite file and creates the current schema; it is not an upgrade command.

`npm run db:migrate` is the non-destructive upgrade operation. It applies each ordered migration once and records its identifier in the database. A legacy database created before migration tracking is baselined at its known pre-migration schema version, then receives only later migrations. The baseline operation must never delete or recreate application tables.

Every schema change has a corresponding ordered migration. Migration SQL is additive or otherwise preserves existing rows; a migration that cannot preserve a changed shape must fail with a clear recovery path rather than silently dropping data.

All database entry points validate that the recorded schema version is current before performing application work. A database that is behind fails fast with an error naming `npm run db:migrate`; it must not defer failure to an arbitrary SQL query.

### Logic Flow

1. `db:init` deletes only the explicitly selected database and creates a fresh current schema.
2. `db:migrate` opens an existing database, creates the migration ledger if needed, baselines known legacy schema without changing application data, and applies pending ordered migrations transactionally.
3. A database client checks the ledger before returning a connection. If migrations are pending, it closes the connection and throws an actionable upgrade error.
4. The devy-claim migration adds nullable `sleeper_rosters.devy_name`; prior Sleeper roster rows remain intact and read as `NULL` for that field.

### Edge Case Probe

- Existing database with Sleeper rows, pick values, and ETL history -> migration adds `devy_name` and preserves every existing row.
- Existing database already at the target version -> `db:migrate` is idempotent and changes no application data.
- Database opened before its pending migration runs -> client fails before application SQL with `Run npm run db:migrate`.
- Fresh database -> `db:init` produces the current schema and migration ledger, so normal startup succeeds immediately.

## Schema

### `players`
Populated by the ETL pipeline. Read-only during drafts.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Full name |
| position | TEXT | QB, RB, WR, TE |
| nfl_team | TEXT | Current NFL team abbreviation |
| age | REAL | Age at season start |
| is_rookie | INTEGER (bool) | 1 if current-year rookie |
| dynasty_value | INTEGER | Aggregated dynasty value (0–9999); average of normalized per-source values |
| dynasty_value_tep / dynasty_value_tepp / dynasty_value_teppp | INTEGER | KTC TE-premium-adjusted dynasty values for TE+, TE++, and TE+++; NULL when KTC did not supply the tier |
| value_ktc | INTEGER | Raw KTC value normalized to 0–9999; NULL if source failed |
| value_fantasycalc | INTEGER | Raw FantasyCalc value normalized to 0–9999; NULL if source failed |
| value_dynastydaddy | INTEGER | Raw DynastyDaddy value normalized to 0–9999; NULL if source failed |
| value_rosteraudit | INTEGER | Raw RosterAudit value normalized to 0–9999; NULL if source failed |
| adp | REAL | Dynasty startup ADP |
| updated_at | TEXT (ISO8601) | Last ETL refresh timestamp |

### `drafts`
One row per mock draft session.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| created_at | TEXT (ISO8601) | |
| completed_at | TEXT (ISO8601) | Null until draft ends |
| status | TEXT | `in_progress`, `completed` |
| team_count | INTEGER | Default 12 |
| rounds | INTEGER | Default 20 |
| scoring_format | TEXT | `ppr`, `half_ppr`, `standard` |
| te_premium_tier | TEXT | `off`, `tep`, `tepp`, `teppp`; independent of `scoring_format` |
| user_pick_position | INTEGER | 1-based pick slot in round 1 |
| future_pick_years | INTEGER | Default 3 |
| future_pick_rounds | INTEGER | Rounds of future picks per year |
| roster_config | TEXT (JSON) | `{ "QB": 1, "RB": 2, "WR": 3, "TE": 1, "FLEX": 1, "SF": 1, "bench": 6 }` |

### `league_configs`
Reusable saved league setups shown in the config-screen dropdown.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Display name entered on the config form |
| team_count | INTEGER | Saved team count |
| rounds | INTEGER | Saved round count |
| scoring_format | TEXT | `ppr`, `half_ppr`, `standard` |
| te_premium_tier | TEXT | `off`, `tep`, `tepp`, `teppp`; independent of `scoring_format` |
| roster_slots | TEXT (JSON) | `{ "QB": 1, "RB": 2, "WR": 3, "TE": 1, "FLEX": 1, "SF": 1, "BN": 6 }` |
| pick_position | INTEGER | Saved 1-based user draft slot |
| future_pick_years | INTEGER | Saved future-pick horizon |
| created_at | TEXT (ISO8601) | Used for newest-first dropdown ordering |

### `teams`
One row per team per draft. Bots get generic names (Bob, Carl, etc.) assigned at draft creation.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| draft_id | TEXT | FK → drafts.id |
| name | TEXT | Display name |
| is_user | INTEGER (bool) | 1 for the human manager's team |
| pick_position | INTEGER | Initial round-1 draft position (1-based) |
| archetype | TEXT | Null for user; e.g. `win_now`, `punt`, `rb_heavy`, `qb_early`, `bpa` for bots |

### `draft_order`
Pre-generated snake order at draft creation. Rows are mutable — pick slot swaps update `team_id` in place.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| draft_id | TEXT | FK → drafts.id |
| pick_number | INTEGER | Global pick number (1–240 for 12×20) |
| round | INTEGER | 1-based round |
| pick_in_round | INTEGER | 1-based position within round |
| team_id | TEXT | FK → teams.id — updated on pick slot swaps |

### `picks`
One row per completed pick. Written immediately when a pick is made. `team_id` is immutable — it records who made the pick, not who currently owns the player. Use `roster_players` for current ownership.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| draft_id | TEXT | FK → drafts.id |
| draft_order_id | TEXT | FK → draft_order.id |
| team_id | TEXT | FK → teams.id — immutable, records who drafted the player |
| player_id | TEXT | FK → players.id |
| pick_number | INTEGER | Denormalized for query convenience |
| round | INTEGER | Denormalized for query convenience |
| picked_at | TEXT (ISO8601) | |

### `roster_players`
Authoritative current roster ownership. One row per player per draft, updated when player-for-player trades execute. This is the source of truth for "who has this player right now" — used by the bot simulator, advisor context assembly, and post-draft analysis.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| draft_id | TEXT | FK → drafts.id |
| team_id | TEXT | FK → teams.id — updated on trade |
| player_id | TEXT | FK → players.id |

### `team_pick_assets`
Tracks which future pick assets each team currently owns. All teams start with identical sets; rows transfer between teams as trades execute. Dynasty value is looked up by joining to `pick_values`.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| draft_id | TEXT | FK → drafts.id |
| team_id | TEXT | FK → teams.id — updated on trade |
| year | INTEGER | e.g. 2026, 2027, 2028 |
| round | INTEGER | 1-based round within that year |

### `pick_values`
Dynasty values for pick assets (both future and startup), populated by the ETL pipeline alongside player values. Keyed by `(year, round, pick_in_round)` — no draft-specific data.

`pick_in_round = 0` is a sentinel meaning "round-level value, no specific slot assigned" — used for future pick assets whose exact slot is unknown. Values with `pick_in_round >= 1` represent exact startup draft slots in a canonical 12-team reference frame.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| year | INTEGER | e.g. 2026, 2027, 2028; startup picks use current calendar year |
| round | INTEGER | 1-based round |
| pick_in_round | INTEGER | 1-based slot within the round; `0` = round-level future pick sentinel |
| dynasty_value | INTEGER | Rounded mean of all non-NULL current-run per-source normalized pick values (0–9999) |
| updated_at | TEXT (ISO8601) | Last ETL refresh timestamp |

Unique constraint: `(year, round, pick_in_round)`.

### `trades`
One row per executed (or declined) trade. Assets are recorded as JSON arrays for flexibility across trade types.

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| draft_id | TEXT | FK → drafts.id |
| pick_number | INTEGER | Pick number at which the trade occurred |
| round | INTEGER | Round at which the trade occurred |
| initiating_team_id | TEXT | FK → teams.id |
| receiving_team_id | TEXT | FK → teams.id |
| assets_sent | TEXT (JSON) | Assets from initiating → receiving team |
| assets_received | TEXT (JSON) | Assets from receiving → initiating team |
| status | TEXT | `accepted`, `declined`, `force_declined` |
| created_at | TEXT (ISO8601) | |

**Trade asset JSON shape:**
```json
[
  { "type": "player", "player_id": "uuid" },
  { "type": "pick_slot", "draft_order_id": "uuid", "pick_number": 7 },
  { "type": "future_pick", "year": 2026, "round": 1 }
]
```

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Per-source value storage | Four nullable columns on `players` | Separate `player_source_values` table | Values are always read together; inline columns avoid a join on the hot path and keep the ETL upsert simple |
| Null per-source columns | NULL when source failed | 0 or sentinel value | NULL is unambiguous: it means "no data from this source", not "player has zero value" |
| Persistence timing | Every pick written immediately | Flush on completion | Continuous writes give full history even if the session is abandoned; no resume required but history is preserved |
| Roster config storage | JSON blob in `drafts` | Separate `roster_slots` table | Roster config is read as a whole and never queried into; JSON blob avoids unnecessary normalization |
| Pick slot mutability | `draft_order.team_id` updated in place | Separate swap log | The current owner of a slot is the authoritative fact; swap history is captured in `trades` |
| Startup pick value storage | Extend `pick_values` with `pick_in_round`; sentinel `0` for round-level future picks | Separate `startup_pick_values` table | Future picks will eventually gain `pick_in_round` values when draft order is assigned; a unified table avoids a schema split for what is the same entity at different information levels |
| Startup pick reference frame | Store 12-team canonical values in DB; derive draft-specific map at creation time | Store per-team-count values or global pick number | Keeps raw ETL data source-faithful (KTC publishes 12-team slots); the conversion is pure arithmetic and happens once per draft, not per lookup |
| Denormalized columns in `picks` | `round` and `pick_number` copied | Always join to `draft_order` | Pick history queries are frequent and read-heavy; denormalizing avoids joins on the hot path |
| Trade asset format | Polymorphic JSON array | Separate columns per asset type | Trades can mix asset types (pick slot + future pick + player); JSON handles arbitrary combinations cleanly |
| UUIDs as PKs | TEXT UUID | Auto-increment INTEGER | Easier to generate client-side and reference across the SSE event stream without a round-trip |

## Open Questions

- [ ] Should `players.dynasty_value` and `players.adp` support multiple scoring formats (PPR vs standard) or is a single value sufficient?
- [ ] Do we need a `draft_order` snapshot before trades to reconstruct the original pick order for analysis?
