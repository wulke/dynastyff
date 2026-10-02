# LLD: Feedback Modal (Static Build)

## Context

A persistent floating "Feedback" button is added to the static GitHub Pages build. Clicking it opens a modal with a single required freeform text field. On submit, the text is POSTed to a Vercel edge function which validates a gate token and creates a GitHub issue in this repo with a `user-feedback` label. The modal closes with a toast and a deep link to the created issue.

Drives specs: `docs/specs/feedback-modal-specs.md`

## Architecture

```
Static site (GitHub Pages)            Serverless function (platform TBD)
┌─────────────────────────┐           ┌──────────────────────────┐
│  FeedbackButton         │           │  POST /api/feedback      │
│  (floating, all screens)│           │                          │
│         ↓               │  POST →   │  1. Validate gate token  │
│  FeedbackModal          │           │  2. GitHub Issues API    │
│  (freeform text input)  │  ← JSON   │     POST /repos/:owner/  │
│         ↓               │           │     :repo/issues         │
│  Toast + issue deep link│           │  3. Return { issueUrl }  │
└─────────────────────────┘           └──────────────────────────┘
```

> **Platform decision deferred.** The serverless function requires a synchronous HTTP endpoint (to return the issue URL for the deep link toast). Candidate platforms: Vercel, Netlify, Cloudflare Workers. To be decided before EARS/implementation.

## Interface / Data Model

### API request

```ts
// POST https://<vercel-app>.vercel.app/api/feedback
type FeedbackRequest = {
  body: string;   // freeform text, required, non-empty
  token: string;  // must match FEEDBACK_GATE_TOKEN env var
};
```

### API response

```ts
// 200 OK
type FeedbackResponse = {
  issueUrl: string;  // https://github.com/wulke/dynastyff/issues/:number
};

// 400  { error: 'body is required' }
// 401  { error: 'unauthorized' }
// 500  { error: 'failed to create issue' }
```

### Environment variables

| Location | Variable | Purpose |
|---|---|---|
| Static build (Vite) | `VITE_FEEDBACK_TOKEN` | Gate token baked into bundle at build time |
| Static build (Vite) | `VITE_FEEDBACK_API_URL` | Vercel function URL (e.g. `https://dynastyff.vercel.app/api/feedback`) |
| Vercel | `FEEDBACK_GATE_TOKEN` | Server-side gate token; must match `VITE_FEEDBACK_TOKEN` |
| Vercel | `GITHUB_PAT` | Personal access token scoped to `issues:write` on this repo |
| Vercel | `GITHUB_REPO` | `wulke/dynastyff` |

### UI state

```ts
type FeedbackModalState =
  | { phase: 'closed' }
  | { phase: 'open'; body: string }
  | { phase: 'submitting'; body: string }
  | { phase: 'success'; issueUrl: string }
  | { phase: 'error'; message: string };
```

## Logic Flow

### FeedbackButton (UI)

1. Renders a fixed-position button at `bottom-right` on every screen inside the static app shell.
2. On click, transitions modal state from `closed` → `open`.

### FeedbackModal (UI)

1. Renders when state is not `closed`.
2. Shows a `<textarea>` bound to `body`; submit button disabled when `body.trim()` is empty or state is `submitting`.
3. On submit:
   a. Transition to `submitting`.
   b. `POST VITE_FEEDBACK_API_URL` with `{ body, token: VITE_FEEDBACK_TOKEN }`.
   c. On 200: transition to `success`; after 200 ms close modal, fire toast with deep link to `issueUrl`.
   d. On non-200 or network error: transition to `error`; show inline error message in modal; allow retry.
4. Dismiss (X button or Escape key) closes modal; resets state to `closed`.

### api/feedback.ts (Vercel edge function)

1. Reject non-POST methods with 405.
2. Parse JSON body; reject missing or empty `body` with 400.
3. Compare `token` to `FEEDBACK_GATE_TOKEN` (constant-time compare); reject mismatch with 401.
4. `POST https://api.github.com/repos/${GITHUB_REPO}/issues` with:
   - `title`: first 72 characters of `body` (truncated with `…` if longer), prefixed `[Feedback] `
   - `body`: full feedback text
   - `labels`: `['user-feedback']`
   - `Authorization: Bearer ${GITHUB_PAT}`
5. On GitHub API success: return 200 `{ issueUrl: issue.html_url }`.
6. On GitHub API failure: log error server-side; return 500 `{ error: 'failed to create issue' }`.
7. Set CORS header `Access-Control-Allow-Origin: https://wulke.github.io` on all responses.

## File Layout

```
src/
  ui-static/
    components/
      FeedbackButton.tsx   — floating trigger button
      FeedbackModal.tsx    — modal + form + toast trigger
    App.tsx                — mounts <FeedbackButton /> in app shell

api/
  feedback.ts              — serverless function (platform TBD)

.env.example               — add VITE_FEEDBACK_TOKEN, VITE_FEEDBACK_API_URL entries
```

## Edge Case Probe

- `body` is whitespace-only → submit button remains disabled; never reaches the API.
- Network request times out (>10s) → treat as error; show "Couldn't send feedback. Try again." in modal; allow retry.
- GitHub API returns 422 (label does not exist yet) → Vercel function catches this; label must be pre-created in the repo before first deploy. Document in README.
- `VITE_FEEDBACK_TOKEN` is missing at build time → Vite build should warn; gate token will be an empty string, causing all requests to be rejected with 401. Add a build-time guard that throws if `VITE_FEEDBACK_TOKEN` is empty.
- `VITE_FEEDBACK_API_URL` is missing at build time → same guard; throw descriptive error.
- User submits twice (double-click) → submit button is disabled during `submitting` phase; only one request fires.
- Vercel function cold start → no special handling; the 10s client timeout absorbs normal cold-start latency.
- Gate token rotated (Vercel env var updated, static build not yet redeployed) → requests return 401; users see error toast. Acceptable: rotation requires a redeployment of both sides.
- CORS preflight from GitHub Pages origin → Vercel function handles OPTIONS with `Access-Control-Allow-Origin` and `Access-Control-Allow-Headers`.
