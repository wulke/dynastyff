# LLD: Sleeper Draft Configuration Import

Drives: `docs/specs/ui-specs.md`

## Interface / Data Model

`GET /league-imports/sleeper/:leagueId` returns a non-persistent config prefill:

```ts
type SleeperDraftConfigPrefill = {
  teamCount: number;
  scoringFormat: 'ppr' | 'half_ppr' | 'standard';
  tePremiumTier: 'off' | 'tep' | 'tepp' | 'teppp';
  rosterConfig: { QB: number; RB: number; WR: number; TE: number; FLEX: number; SF: number; bench: number };
};
```

The route fetches `https://api.sleeper.app/v1/league/{leagueId}` with an injected `fetch` dependency for deterministic route tests. It validates the public response fields before mapping them, and returns a client-safe error for a non-success response, unreachable API, or malformed response.

The Config screen owns a separate `sleeperLeagueReference` input and import error/loading state. It extracts a numeric league ID from either a bare ID or a `sleeper.app` / `sleeper.com` league URL, then requests the endpoint. The existing `ConfigFormState` remains the editable source of truth.

## Mapping

| Sleeper field | App field | Rule |
|---|---|---|
| `num_teams` | `teamCount` | Preserve the returned integer; the existing form sanitization enforces its supported 8–16 range. |
| `scoring_settings.rec` | `scoringFormat` | `0` → `standard`, `0.5` → `half_ppr`, `1` → `ppr`; any other numeric reception value maps to the closest of those supported formats. |
| `scoring_settings.bonus_rec_te` | `tePremiumTier` | `0`/absent → `off`, `0.5` → `tep`, `1` → `tepp`, `1.5` → `teppp`; an unsupported bonus falls back to `off`. |
| `roster_positions` | `rosterConfig` | Count exact `QB`, `RB`, `WR`, `TE`, `FLEX`, `SUPER_FLEX`, and `BN` entries into `QB`, `RB`, `WR`, `TE`, `FLEX`, `SF`, and `bench`, respectively. Ignore positions unsupported by the startup simulator (for example K, DEF, IDP, TAXI, IR). |

`draft_rounds` is deliberately absent from both the normalized response and the form update. After a successful import, the Config screen calculates `rounds` with the roster-slot-sum suggestion introduced by #167, rather than trusting Sleeper's draft history setting. The selected user pick position is clamped to the imported team count by the existing config sanitization.

## Logic Flow

1. User enters a Sleeper league ID or full league URL and selects Import.
2. The screen validates and extracts the league ID locally. Invalid input shows an inline error and does not alter the form.
3. The screen requests `GET /league-imports/sleeper/:leagueId`, disabling only the Import action while it is pending.
4. The server requests the public Sleeper league endpoint, maps only supported settings, and responds with `SleeperDraftConfigPrefill`.
5. On success, the screen merges the prefill into `ConfigFormState`, sets `rounds` from the roster-slot total suggestion, clears any import error, and leaves every form control editable.
6. On a non-OK or malformed client response, the screen shows a clear inline error and preserves the current manual values.
7. `Start Draft` and `Save` continue to submit the current form values through their existing paths.

## Edge Case Probe

- Bare ID has whitespace -> trim before requesting.
- Full URL contains a query string or trailing path -> extract the league ID from its league path segment.
- URL is not a Sleeper league URL, or ID is empty/non-numeric -> show “Enter a valid Sleeper league ID or URL.” without a network request.
- Sleeper returns 404, 5xx, or a network failure -> endpoint returns a clear import failure; UI keeps manual fields unchanged and shows “Could not import Sleeper league settings. Check the league ID and try again.”
- Sleeper fields are absent or not valid types -> treat the response as malformed and use the same manual-entry fallback.
- Sleeper roster has no supported positions -> return zeroes for each mapped roster slot; the form remains editable and its existing constraints apply.
- Sleeper `num_teams` or roster counts exceed app limits -> form sanitization clamps them exactly as manual entry does.
- Sleeper includes `draft_rounds`, including a value that conflicts with roster size -> ignore it completely; only the roster-slot total suggestion updates `rounds`.
