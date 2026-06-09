# EARS Specs: UI Unification (Static + App Build)

Drives: `docs/llds/ui.md`, `docs/llds/static-build.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred/retired

---

## Background

The static (GitHub Pages) build historically maintained its own view-state logic and draft room layout in `src/ui-static/App.tsx`. This caused feature drift: every change to the app's drafting UI required a parallel update to the static build. This Epic eliminates that drift by making both builds share a single `DraftApp` shell, with provider-level stubs handling the static/HTTP surface-area differences.

---

## Shared App Shell

**DFF-UI-150** `[x]` → #109
The system shall export `DraftApp` as a named export from `src/ui/App.tsx`, separate from the existing `App` export that bundles `HttpDraftContextProvider` with `DraftApp`.

**DFF-UI-151** `[x]` → #109
When `DraftContextValue.snapshot` is non-null, the Config screen shall render snapshot stats — player count, pick values count, and export date — as supporting content below the draft configuration form.

**DFF-UI-152** `[x]` → #110
`src/ui-static/App.tsx` shall handle snapshot loading, the stale-data banner, and full-screen error states, and shall wrap `InMemoryDraftContextProvider` around `DraftApp` (imported from `src/ui/App.tsx`). It shall not define its own draft room component, view-state machine, or history transition logic.

**DFF-UI-153** `[x]` → #110
`src/ui-static/App.tsx` shall not contain a `DraftRoom`, `StaticDraftApp`, or `StaticHistoryView` component after this refactor.

---

## Static Build Behaviour Post-Refactor

**DFF-UI-154** `[x]` → #110
The static build shall render `DraftStatusBar`, the three-column drafting layout (`DraftBoard`, `AvailablePlayersPanel`, `PickFeedPanel`), and column expand/collapse controls — identical to the HTTP app's drafting view (as specified by DFF-UI-130 through DFF-UI-139).

**DFF-UI-155** `[x]` → #110
When a static draft reaches `status: completed`, the system shall render the draft completion banner over the Draft Board, consistent with DFF-UI-003. The prior auto-transition to the history view on draft completion is retired.

**DFF-UI-156** `[x]` → #110
When the user clicks "View Full History" from the completion banner in the static build, the system shall transition to the History view, consistent with DFF-UI-006.

**DFF-UI-157** `[x]` → #110
When the static build's `GET /drafts` request returns a non-OK response (including a 404 from the absence of an Express server), the system shall silently resolve to the Config screen without displaying an error — `showError` is a no-op stub in the static context.

---

## App UX Baseline Lock

**DFF-UI-158** `[ ]` → #111
The test file `tests/ui-app-scaffold.test.tsx` is the authoritative UX baseline for the HTTP app build. This refactor shall not alter any assertion, helper, or test case in that file. CI shall verify the full suite passes without modification.

**DFF-UI-159** `[ ]` → #111
After the refactor, `tests/ui-static-app.test.tsx` shall include a seam test covering the static-to-drafting wiring: resolve the snapshot fetch, trigger a draft start, and assert that `data-testid="draft-status-bar"`, `data-testid="drafting-layout"`, and all three column headings ("Draft Board", "Available Players", "Pick Feed") are present in the rendered output.

**DFF-UI-160** `[ ]` → #111
The test file `tests/ui-static-history-app.test.tsx` shall be deleted. Its covered behaviors (DFF-STATIC-034, DFF-STATIC-035, DFF-STATIC-036, DFF-STATIC-063) are retired by this Epic; the underlying draft-to-history flow in the static build is now identical to the app's and is covered by `tests/ui-app-scaffold.test.tsx`.

---

## Documentation Updates

**DFF-UI-161** `[ ]` → #112
`docs/llds/static-build.md` shall be updated to reflect the shared-`DraftApp` architecture: `src/ui-static/App.tsx` handles only snapshot loading and provider wiring; the view-state machine and all draft UI components are owned by `src/ui/App.tsx`.

**DFF-UI-162** `[ ]` → #112
`docs/llds/ui.md` shall be updated to note that `DraftApp` is the shared app shell consumed by both the HTTP and static builds, and that `src/ui/App.tsx` is the source of truth for all draft room UI behaviour.

---

## Retired Static Specs

The following specs from `docs/specs/static-build-specs.md` are retired by this Epic. Mark each `[D]` and add the tombstone note shown.

**DFF-STATIC-034** → `[D]` *Retired by UI Unification Epic; static bot loop timing behaviour is covered by `tests/in-memory-draft-engine.test.ts` and the shared `InMemoryDraftContextProvider`.*

**DFF-STATIC-035** → `[D]` *Retired by UI Unification Epic; static bot loop halt-on-user-turn behaviour is covered by `tests/in-memory-draft-engine.test.ts` and the shared `InMemoryDraftContextProvider`.*

**DFF-STATIC-036** → `[D]` *Retired by UI Unification Epic; the static Draft Room is replaced by the shared three-column layout specified in DFF-UI-130 through DFF-UI-139 and DFF-UI-154.*

**DFF-STATIC-063** → `[D]` *Retired by UI Unification Epic; the static app now wraps `InMemoryDraftContextProvider` around the shared `DraftApp` (DFF-UI-152) rather than defining its own view-state machine.*
