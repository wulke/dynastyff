# Research: Sleeper Draft API surface for the live draft board

> **Wayfinder ticket:** [#175 — Research: Sleeper draft API surface for the live draft board](https://github.com/wulke/dynastyff/issues/175)
> **Parent map:** [#174 — Live Draft trade-idea assistant](https://github.com/wulke/dynastyff/issues/174)
> **Captured:** 2026-08-09 · branch `research/sleeper-draft-api`
> **Purpose:** Pin the concrete Sleeper draft-API contract so the *ingestion + storage* ticket (graduates from map fog) and the *trade-idea generator* ticket can be specified precisely.

## How to read this document (confidence levels)

Every claim below is tagged with its source so the downstream tickets know what is nailed down vs. what to re-check against a real connected draft.

| Tag | Meaning |
|---|---|
| **[LIVE]** | Confirmed by a live `api.sleeper.app` call on 2026-08-09 against the documented example draft `257270643320426496` / league `257270637750382592`. |
| **[DOCS]** | Stated in the official Sleeper API docs (https://docs.sleeper.com), including the example payloads. |
| **[INFERRED]** | Not stated in the docs and not directly observable in the example data; conventional Sleeper behaviour that the ingestion ticket **must confirm against the user's real startup draft**. |
| **[CAUTION]** | Confirmed on a *complete historical* draft; a *live, actively-drafting* draft may behave differently and must be re-verified. |

All endpoints are read-only, `https://api.sleeper.app/v1/…`, JSON over HTTPS, HTTP/2. **No authentication is required for any read** — the docs state *"We do not perform authentication as our API is read-only and only contains league information"* **[DOCS]**, and every call in this research succeeded with no auth header **[LIVE]**. This matches the existing `docs/llds/sleeper-sync.md` ingestion, which already treats the Sleeper API as unauthenticated read-only.

---

## 1. Endpoint inventory

Six endpoints are in scope for the live draft board. Five live under the **Drafts** resource; the sixth is the league-level traded-pick ledger (distinct from the draft-level one, and the one that already aligns with the existing `sleeper_transactions` ingestion).

| Endpoint | Returns | Used for |
|---|---|---|
| `GET /league/{league_id}/drafts` **[LIVE]** | array of draft objects (most-recent first) | Find the league's **startup** draft; pick the draft to track. |
| `GET /user/{user_id}/drafts/{sport}/{season}` **[DOCS]** | array of draft objects | Alternative discovery by user/season (sport = `nfl`). Not needed if we start from a league id (we do). |
| `GET /draft/{draft_id}` **[LIVE]** | single draft object | Draft metadata: type, status, settings (teams/rounds/timer/slots), `draft_order`, `slot_to_roster_id`. |
| `GET /draft/{draft_id}/picks` **[LIVE]** | array of pick objects | The **live board** — picks made so far. |
| `GET /draft/{draft_id}/traded_picks` **[DOCS]** | array of traded-pick objects | Picks traded **within this draft** (round/owner mapping). Empty for a fresh startup. |
| `GET /league/{league_id}/traded_picks` **[LIVE]** | array of traded-pick objects | League-level **future-pick ledger** (the season/rookie-pick owner map). Distinct endpoint; returned `[]` for the example league. |

> **No "pick on the clock" endpoint exists.** The Drafts resource exposes only the five endpoints above **[DOCS/LIVE]**. "Whose pick is currently up" must be **derived** from the picks list + draft order + slot/roster mapping (see §6).

The existing `sleeper-sync` pipeline already consumes `/league/{id}`, `/rosters`, `/users`, `/transactions/{week}`, and `/players/nfl`. The draft board adds `/league/{id}/drafts`, `/draft/{id}`, `/draft/{id}/picks`, and the two traded-picks endpoints — a new, parallel ingestion path that reuses the same unauthenticated-fetch + SQLite-persist shape.

---

## 2. Draft object (`GET /draft/{draft_id}`)

Top-level keys observed **[LIVE]**: `created`, `creators`, `draft_id`, `draft_order`, `last_message_id`, `last_message_time`, `last_picked`, `league_id`, `metadata`, `season`, `season_type`, `settings`, `slot_to_roster_id`, `sport`, `start_time`, `status`, `type`.

| Field | Type | Notes |
|---|---|---|
| `draft_id` | string | The draft's identity; used for `/picks` and `/traded_picks`. |
| `league_id` | string | Back-reference to the league; lets us resolve rosters/users via existing sync. |
| `league_id` | string | |
| `type` | string | **`snake`** confirmed **[DOCS/LIVE]**. `auction`, `linear` are conventional values but **[INFERRED]** — not in docs; confirm against the real startup league (the generator math differs for auction/linear). |
| `status` | string | Draft lifecycle. Only `"complete"` is shown in docs **[DOCS]**. `pre_draft` / `drafting` are conventional **[INFERRED]** — note the docs document the `pre_draft`/`drafting`/`in_season`/`complete` enum for the **league** `status`, not the draft; the draft field is widely observed to mirror `{pre_draft, drafting, complete}`. |
| `season` | string | e.g. `"2017"`. **[LIVE]** |
| `season_type` | string | e.g. `"regular"`. **[LIVE]** |
| `sport` | string | `"nfl"`. **[LIVE]** |
| `start_time` | int (ms epoch) | Draft scheduled start. **[LIVE]** |
| `created` | int (ms epoch) | **[LIVE]** |
| `last_picked` | int (ms epoch) \| null | Timestamp of the most recent pick — useful as a cheap *"did the board change?"* sentinel between full `/picks` fetches. **[LIVE]** |
| `last_message_time`, `last_message_id` | int/string \| null | Draft-chat watermark; not needed for the board. |
| `creators` | array \| null | Draft commissioners. |

### `settings` (the board's geometry) — **[DOCS/LIVE]**

```
{
  "teams": 6,
  "rounds": 15,
  "pick_timer": 120,          // seconds per pick
  "slots_qb": 1, "slots_rb": 2, "slots_wr": 2, "slots_te": 1,
  "slots_flex": 2, "slots_def": 1, "slots_k": 1, "slots_bn": 5
}
```

`teams` × `rounds` is the **configured** board capacity. Note the example draft had `rounds: 15` but only **30 picks were actually made** (rounds 1–5) **[LIVE]** — `settings.rounds` is capacity, not a guarantee of how many picks the draft will contain. Treat the true board length as `picks.length` while `status != "complete"`, and final length only when complete.

### `draft_order` — **[DOCS/LIVE]**

Maps **user_id → draft slot** (column on the board):

```
"draft_order": { "199042945356140544": 1, "200837482281963520": 2, … }
```

Can be `null` before the draft is set up **[DOCS]**.

### `slot_to_roster_id` — **[DOCS/LIVE]** *(the critical field for wiring picks to teams)*

Maps **draft slot (column) → `roster_id`**:

```
"slot_to_roster_id": { "1": 10, "2": 3, "3": 5 }
```

A pick's `roster_id` is the team that **receives** the player; `draft_slot` is the board column. In traded-pick scenarios these can differ (the slot is on the clock, but the pick lands on a different roster that acquired it). Join: `pick.roster_id → sleeper_rosters` (existing) gives the team; `pick.draft_slot → slot_to_roster_id` confirms who was on the clock.

### `metadata` — **[LIVE]**

```
{ "scoring_type": "ppr", "name": "My Dynasty", "description": "" }
```

---

## 3. Identifying a **startup** draft

There is **no `is_startup` flag** **[DOCS/LIVE]**. Sleeper models a dynasty league as **one draft per season**; the docs note *"a league can have multiple drafts, especially dynasty leagues… sorted by most recent to earliest"* **[DOCS]**.

**Startup identification rule (INFERRED, confirm against the connected league):**

> The startup draft is the **earliest-season** entry in `GET /league/{league_id}/drafts`. For a brand-new league it is the only entry. A later-season draft (rookie/vet) is out of scope for this effort per map #174.

`GET /league/{league_id}/drafts` **[LIVE]** returns the array most-recent-first; pick the **last** element (or filter to `min(season)`), then load it via `GET /draft/{draft_id}`. Confirm at connect time that the chosen draft's `season` equals the league's inaugural season (cross-check with `league` metadata from existing sync).

---

## 4. Pick object (`GET /draft/{draft_id}/picks`)

Keys observed **[LIVE]**: `draft_id`, `draft_slot`, `is_keeper`, `metadata`, `pick_no`, `picked_by`, `player_id`, `reactions`, `roster_id`, `round`.

```
{
  "player_id": "2391",
  "picked_by": "200837482281963520",   // user_id the pick goes to (can be "")
  "roster_id": "1",                     // roster_id the pick goes to
  "round": 5,
  "draft_slot": 1,                      // board column this pick was made from
  "pick_no": 1,                         // global 1-based pick index
  "is_keeper": null,                    // truthy => keeper
  "reactions": null,                    // NEW vs docs example; emoji reactions
  "metadata": {                         // player snapshot at pick time
    "player_id": "2391", "first_name": "David", "last_name": "Johnson",
    "position": "RB", "team": "ARI", "number": "31",
    "status": "Injured Reserve", "injury_status": "Out",
    "news_updated": "1513007102037", "sport": "nfl"
  },
  "draft_id": "257270643320426496"
}
```

**Confirmed behaviour [LIVE]:**

- Returns **made picks only**. The example (complete draft) had **zero** picks with a null `player_id`; there are **no queued/upcoming slots** in the array.
- `pick_no` is **contiguous starting at 1** (observed `1..30`, contiguous). Therefore **the next pick on the clock = `pick_no = picks.length + 1`** (when `status == "drafting"`).
- `player_id` maps to the existing **Sleeper player registry** (`/players/nfl`, already cached at `data/sleeper-players-cache.json` by `sleeper-sync`) → then to the canonical `players` table. **No new player-ingestion path is needed.**
- `picked_by` can be `""` for leagues where a slot has no user **[DOCS]** — always key off `roster_id`, not `picked_by`.
- `is_keeper` flags keeper picks (relevant only for keeper leagues; startup is non-keeper, expect `null`).

---

## 5. Traded picks — two distinct endpoints

### `GET /draft/{draft_id}/traded_picks` — within this draft **[DOCS]**

```
{
  "season": "2019",
  "round": 5,
  "roster_id": 1,           // roster_id of ORIGINAL owner
  "previous_owner_id": 1,   // roster_id of previous owner
  "owner_id": 2             // roster_id of CURRENT owner
}
```

This is where **future-round picks traded mid-startup** surface (map fog: "Future picks traded during the startup"). Returns `[]` for an unstarted/fresh draft. Confirmed shape; empty in the example **[LIVE]**.

### `GET /league/{league_id}/traded_picks` — league future-pick ledger **[LIVE]**

Distinct endpoint (also listed under the Leagues resource). Same object shape. Returned `[]` for the example league. This is the season-spanning ledger of future-pick ownership; aligns with how the existing `sleeper_transactions` ingestion already models picks-as-assets.

**For the trade-idea generator:** a pick's *current* owner (who can trade it / who receives the player) is `traded_picks[].owner_id`, overriding the original `roster_id`. Resolve ownership from traded-picks **before** scoring chart fairness.

---

## 6. Draft status & "whose pick is up"

There is **no on-the-clock endpoint** — derive it **[DOCS/LIVE]**:

1. From `GET /draft/{draft_id}`: read `status`, `type`, `settings.teams`, `settings.rounds`, `draft_order`, `slot_to_roster_id`.
2. From `GET /draft/{draft_id}/picks`: `made = picks.length`; `next_pick_no = made + 1`.
3. Derive the slot on the clock from `next_pick_no` + draft type:
   - **snake**: slot for pick *p* in an *N*-team snake = `((p-1) mod N) + 1` on odd rounds, reversed on even rounds.
   - **linear**: always `((p-1) mod N) + 1`.
   - **auction**: no concept of a slot on the clock (nominations) — out of scope unless the connected league is auction.
4. Map that slot → `roster_id` via `slot_to_roster_id`, then → team via `sleeper_rosters`.
5. `status == "complete"` ⇒ board is final; `status == "pre_draft"` ⇒ no picks yet, nothing on the clock; `status == "drafting"` ⇒ the slot from step 3 is on the clock.

Status enum: only `"complete"` is documented for the draft object **[DOCS]**; `pre_draft`/`drafting` are **[INFERRED]** (the docs enumerate that enum for the *league* status). Re-confirm draft-status values on the real startup draft before relying on them.

---

## 7. Polling characteristics (the part that most affects the live UX)

### No published rate limit **[DOCS]**

The docs have **no rate-limit page** and **no `X-RateLimit-*` headers** are returned **[LIVE]**. The docs' only request-volume guidance is around trending players, not drafts. Practically: the Sleeper API is generous for read traffic, and at startup-draft pace (often hours per pick) volume is trivial. Still: be polite, use the conditional-get and `last_picked` short-circuits below, and back off on `429`/`5xx`.

### Caching is per-endpoint and ETag-driven **[LIVE/CAUTION]**

| Endpoint | `Cache-Control` (observed) | Implication |
|---|---|---|
| `GET /draft/{draft_id}` (metadata) | `public, s-maxage=30, stale-while-revalidate=300, stale-if-error=600` | Edge-cached 30s; fine to poll metadata every ~30–60s. |
| `GET /draft/{draft_id}/picks` | `public, s-maxage=86400, stale-while-revalidate=300` | **Edge-cached up to 24h.** ⚠️ A naive poll during a live draft could serve stale picks. |

> ⚠️ **[CAUTION]** The 24h `s-maxage` was observed on a *complete 2017* draft. An **actively-drafting** draft may carry shorter directives — **re-verify against the real connected startup draft before finalising the poller.** Regardless, design defensively (below).

### Conditional GET: ETag / `If-None-Match` **works**; `If-Modified-Since` does not **[LIVE]**

- Every response carries an `etag` (`W/"…"`), and `access-control-expose-headers: etag,date`.
- `If-None-Match: <etag>` → **HTTP 304** with an empty body when unchanged; a non-matching etag → **200** with full body. **Confirmed live.**
- `If-Modified-Since` (even a future date) → **200** (ignored). Do **not** rely on it.

### Recommended poll strategy for the ingestion ticket

1. **Cadence:** poll `/draft/{draft_id}` metadata every ~60s while `status == "drafting"`. It is cheap (30s edge TTL) and carries `last_picked`.
2. **Short-circuit:** store the last `last_picked` value; if it is unchanged, **skip** the `/picks` fetch entirely (no board change).
3. **When `last_picked` advances:** fetch `/draft/{draft_id}/picks` **with `If-None-Match`** of the last picks ETag to defeat the long edge TTL and get a real 304-vs-200. Only persist when you get a 200.
4. **Refresh traded-picks** (`/draft/{draft_id}/traded_picks`) on the same trigger; fetch the league-level ledger (`/league/{id}/traded_picks`) once at connect and again when a trade transaction is detected.
5. **Backoff:** exponential on `429`/`5xx`; hard-stop polling when `status == "complete"` (one final full fetch + persist, then idle).
6. **Completion:** when `status` flips to `complete`, do one final fetch of picks + traded_picks and mark the session concluded (feeds the map's persistence/lifecycle fog).

This cadence is far below any conceivable rate ceiling even at a fast live draft, and the `last_picked` short-circuit means the heavy `/picks` payload is fetched only when the board actually changes.

---

## 8. What this means for the ingestion + storage ticket

The next ticket (graduates from map fog: *"Ingestion & storage specifics"*) can now be specified against this contract. Suggested shape (decision belongs to that ticket, not here):

- **Fetch layer:** extend `src/etl/sleeper/` with a `fetchDraft(draftId)` / `fetchDraftPicks(draftId)` / `fetchTradedPicks(draftId)` mirroring the existing `fetchLeagueState()` pattern; reuse the `/players/nfl` cache for player resolution — no new player ingestion.
- **Storage (new SQLite tables):** the board needs at least:
  - `sleeper_drafts` — one row per tracked draft (`draft_id`, `league_id` FK, `type`, `status`, `season`, `settings_json`, `draft_order_json`, `slot_to_roster_id_json`, `last_picked`, `synced_at`).
  - `sleeper_draft_picks` — one row per made pick (`draft_id` FK, `pick_no`, `round`, `draft_slot`, `roster_id` FK, `player_id` → `players`, `picked_by`, `is_keeper`, `metadata_json`); unique on `(draft_id, pick_no)`.
  - `sleeper_draft_traded_picks` — `draft_id`/`league_id`, `season`, `round`, `roster_id` (original), `owner_id` (current).
  - optional `sleeper_draft_sync_runs` mirroring `sleeper_sync_runs` for observability.
- **Startup selection at connect time:** earliest-season draft from `/league/{id}/drafts` (§3).
- **On-the-clock derivation:** pure function over picks + draft metadata (§6) — no API call.

---

## 9. Re-verify against the real connected startup draft

These are the items the ingestion ticket should confirm once the user connects an actual 2026 startup draft (the example here is a 2017 complete snake draft):

- **[CAUTION]** `Cache-Control` on `/picks` for a `status == "drafting"` draft (may be shorter than the 24h seen on the complete draft) — confirms whether `If-None-Match` is load-bearing or just nice-to-have.
- Draft `type` value for the league (snake vs auction/linear) — changes board-order math.
- Draft `status` transitions actually observed: `pre_draft` → `drafting` → `complete`.
- Non-null `draft/{id}/traded_picks` payload once a future pick is traded mid-draft.
- Whether `reactions` and any other newer fields need persisting.

---

## Sources

1. **Official Sleeper API docs — Drafts** (primary; endpoint paths + example payloads + the *"multiple drafts per dynasty league"* note): https://docs.sleeper.com#drafts
2. **Official Sleeper API docs — Introduction** (no-auth statement): https://docs.sleeper.com — *"We do not perform authentication as our API is read-only and only contains league information."*
3. **Official Sleeper API docs — Leagues** (league `status` enum `pre_draft`/`drafting`/`in_season`/`complete`; `/league/{id}/traded_picks`): https://docs.sleeper.com#leagues
4. **Live API calls, 2026-08-09** against documented example `draft_id=257270643320426496`, `league_id=257270637750382592`: confirmed endpoint behaviour, object shapes (incl. the newer `reactions` pick field), `pick_no` contiguity, `slot_to_roster_id`, ETag/`If-None-Match`→304, `If-Modified-Since` ignored, per-endpoint `Cache-Control`.
5. **Existing repo ingestion contract:** `docs/llds/sleeper-sync.md` (unauthenticated read-only Sleeper fetch + `sleeper_*` SQLite tables + `/players/nfl` cache reused here).
