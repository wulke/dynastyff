# LLD: Devy Rankings View (Ownership + Notes)

Drives specs: `docs/specs/devy-rankings-view-specs.md`

## Context

The global Devy view (`src/ui/components/DevyView.tsx`, specs `DFF-DEVY-040…045`) already renders the KTC devy board with position/draft-year/school filters and a superflex/1QB toggle, fed by `GET /devy-players` or the static snapshot. It knows nothing about the user's Sleeper league and has no way to keep per-player scouting notes.

The devy-claims feature (`docs/llds/devy-claims.md`) already persists taxi-nickname claims as `sleeper_rosters.devy_name` and resolves them against the board server-side via `createDevyBoardMatcher` (`src/server/devy-claims.ts`). This LLD reuses that machinery to put an ownership indicator on every rankings row, and adds lightweight per-player notes. The user runs exactly one Sleeper league with devy players, so no multi-league picker is introduced: the UI resolves ownership against the first connected league.

Builds on `docs/llds/devy-claims.md` (matcher, claims route), `docs/llds/devy-player-values.md` (DevyView), and `DESIGN.md` (modal treatment). HLD decision: `docs/high-level-design.md` → "Devy Rankings View Decision".

## Data Model

### New table `devyPlayerNotes` (`src/db/schema.ts`)

```ts
export const devyPlayerNotes = sqliteTable('devy_player_notes', {
  playerId: text('player_id').primaryKey(),   // devy_players.id
  note: text('note').notNull(),
  updatedAt: text('updated_at').notNull(),    // ISO timestamp
});
```

- Keyed by `devy_players.id`, which is stable across `etl:devy` runs (the upsert conflicts on `(name, position)` and never regenerates ids), so notes survive board refreshes.
- No FK to `devy_players`: notes outliving a board row are harmless (the UI only ever looks up ids present in the board), and the devy ETL never deletes rows today.
- Shipped as additive migration `drizzle/0003_wise_famine.sql` per the schema-lifecycle rules in `docs/llds/data-model.md`: existing local DBs gain the table via `npm run db:migrate` without touching any existing row, so user-authored notes survive upgrades. (`npm run db:init` remains a deliberate destructive fresh start.)

### Ownership — no schema change

Ownership is derived at read time from `sleeper_rosters` (`slot_type='taxi' AND devy_name IS NOT NULL`), joined to `devy_players` by the matcher's normalized names, exactly like the claims route.

## Logic Flow

### Server — ownership resolution (`src/server/devy-claims.ts`)

- The board query gains `id`: `SELECT id, name, position, school, draft_year, value_superflex FROM devy_players`.
- New matcher method:

  ```ts
  /** devy_players.id -> owning team name for every board row claimed in the league. */
  resolveOwnership: (claims: Iterable<{ devyName: string; teamName: string }>) => Record<string, string>
  ```

  For each claim, resolve its normalized name (aliases included, same `resolveNorm` path as `match`) to a board row and set `rows[row.id] = teamName`. When two teams claim the same normalized name, the **lexicographically first `teamName`** wins (deterministic; Sleeper convention says this shouldn't happen, but the data is free-text).

### Server — ownership route (`src/server/season-routes.ts`)

`createSeasonDevyOwnershipRoute({ databasePath })`, mounted as `GET /season/:league_id/devy/ownership` in `src/server/app.ts`:

1. Missing league id → 400 (same as the claims route).
2. `assembleLeagueContext` → unknown/never-synced league → `handleContextError` maps to 404, matching sibling season routes.
3. Collect claims from `context.allRosters` (taxi rows with `devyName`), team name from `team.teamName ?? team.displayName`.
4. Respond `200 { ownership: matcher.resolveOwnership(claims) }` — an empty object when the league has no claims.

### Server — notes routes (new `src/server/devy-notes.ts`)

- `createDevyNotesListRoute({ databasePath })` → `GET /devy-notes` →
  `200 { notes: Record<playerId, { note: string; updatedAt: string }> }` (empty object when none).
- `createDevyNotePutRoute({ databasePath })` → `PUT /devy-notes/:player_id`, body `{ note: unknown }`:
  - Non-string `note` → `400 { error }`.
  - Trimmed-empty string → **delete** the row (idempotent) → `200 { playerId, note: '', updatedAt: null }`.
  - Otherwise upsert with `updatedAt = new Date().toISOString()` → `200 { playerId, note, updatedAt }`.
  - Blank `player_id` param → `400`.
- Both open the SQLite database per request (`createDrizzleDb`/direct better-sqlite3 like sibling routes) and register in `src/server/app.ts` next to `/devy-players`.

### UI — data (`src/ui/App.tsx`)

On mount (next to the existing `/devy-players` fetch):

1. `GET /devy-notes` → `notes: Record<playerId, string>` state.
2. `GET /sleeper/connections` → first connection's `leagueId` → `GET /season/:id/devy/ownership` → `ownership: Record<playerId, teamName>` state. Failures (no connections, fetch error, 404) leave ownership `null` = **unknown**, never a hard error.
3. `onSaveNote(playerId, note)` → `PUT /devy-notes/:playerId`, then updates local notes state from the response.

### UI — view (`src/ui/components/DevyView.tsx`)

New optional props (all default to "feature off", so the static/snapshot path and existing tests are untouched):

```ts
{
  players: readonly DevyPlayer[];
  ownership?: Record<string, string> | null; // null/undefined = unknown
  notes?: Record<string, string>;
  onSaveNote?: (playerId: string, note: string) => Promise<void>;
}
```

- **Owner column** appended to the grid: `ownership` unknown → muted `—`; known → team-name badge (`rounded border border-default bg-surface-hover px-1 py-0.5 text-xs text-secondary`) or muted `Unowned`.
- **Notes icon**: per-row icon button (inline SVG pencil, `aria-label="Notes: <name>"`), `text-accent` when a note exists, `text-muted hover:text-secondary` otherwise; right-most grid column.
- **Notes modal** (component state: `notesPlayerId`, `draft`, `saving`): per `DESIGN.md` — overlay `fixed inset-0 bg-black/60 backdrop-blur-sm`, panel `bg-surface-raised border border-strong rounded-lg p-4 shadow-lg w-full max-w-md`, header with player name + DEVY badge, `aria-modal` dialog semantics, textarea prefilled from the saved note, footer **Save** (accent; disabled while saving) / **Delete** (negative, only when a saved note exists) / **Cancel**. Backdrop click closes and discards the draft. Save/Delete call `onSaveNote` and close on resolution; on rejection the modal stays open with the draft intact and shows an inline `role="alert"` error (`text-negative`), cleared on the next save attempt. If `onSaveNote` is absent the modal is not reachable.

## Edge Case Probe

- **Two teams claim the same normalized devy name** → `resolveOwnership` keeps the lexicographically first `teamName`; response stays deterministic across requests.
- **Claim name that matches no board row** (deep stash off-board) → contributes nothing to the ownership map; it remains visible in the claims panel, not the rankings view.
- **`ownership` fetch fails / no connected leagues / league never synced** → `ownership` stays `null`; every row shows `—` (unknown), never a false "Unowned".
- **Notes for a player id no longer on the board** → row lingers in `devy_player_notes`, ignored by the UI; harmless because the devy ETL never prunes rows today.
- **`npm run db:init`** → explicitly destructive fresh start; notes are lost (accepted convention — `db:migrate`, not `db:init`, is the upgrade path, and migration `0003` carries the notes table to existing DBs losslessly).
- **PUT with non-string / missing `note`, or any failed save** → `400`/network error; UI keeps the modal open with its local draft and an inline error.
- **PUT with whitespace-only note** → treated as delete; icon highlight clears.
- **Notes request against a missing or outdated database schema** → the schema-guarded open fails; both notes routes forward it via `next(error)` so the shared error middleware returns a 500, rather than the error escaping the handler (DFF-DVR-016, mirroring #241).
- **Snapshot-fed DevyView (static build path)** → new props absent; the Owner and notes columns render only when the corresponding props are provided, so the snapshot path stays pixel-identical to today.
- **Board refresh (`etl:devy`) between note save and view** → ids stable via `(name, position)` upsert; note stays attached.
