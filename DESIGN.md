# DESIGN.md

Design system for Dynasty Fantasy Football draft tool. Vision: **sports analytics dashboard** — data-dense, high-contrast, sharp boundaries. Think "Excel for Dynasty": every pixel earns its place, information over decoration.

---

## Visual Direction

- **Feel**: Sports analytics / data terminal. Bold typography, tight layout, maximum data per viewport.
- **Density**: Sharp and dense. Minimal padding and margins. More rows visible without scrolling.
- **Contrast**: High contrast text on dark surfaces. Data must be scannable at a glance.
- **Motion**: Minimal. Only transitions that communicate state (expand/collapse, modal open).

---

## Theming

Themes are applied via a `data-theme` attribute on `<html>`. All color tokens are CSS custom properties. Tailwind classes reference these variables via `tailwind.config.ts` semantic extensions.

Three built-in themes:

| Theme | Accent | Surfaces | Feel |
|---|---|---|---|
| `ember` | Amber `#FCD34D` | Stone | Warm, trophy-case, default |
| `volt` | Blue `#3B82F6` | Slate | ESPN/data-dashboard |
| `pitch` | Lime `#84CC16` | Zinc | DraftKings/value-positive |

A persistent theme switcher lives in the app header/nav, always accessible.

---

## Color Tokens

All color usage in components must reference these semantic token names — never hardcode Tailwind palette colors like `text-amber-300` or `bg-stone-900`.

### Surface & Background

| Token | Tailwind class | Description |
|---|---|---|
| `--color-bg` | `bg-app` | Page background |
| `--color-surface` | `bg-surface` | Card / panel background |
| `--color-surface-raised` | `bg-surface-raised` | Modal, popover, elevated card |
| `--color-surface-hover` | `bg-surface-hover` | Row / item hover state |

### Border

| Token | Tailwind class | Description |
|---|---|---|
| `--color-border` | `border-default` | Default border (cards, dividers) — from `borderColor.default` |
| `--color-border-strong` | `border-strong` | Emphasized border (active, focus) — from `borderColor.strong` |

### Text

| Token | Tailwind class | Description |
|---|---|---|
| `--color-text-primary` | `text-primary` | Body text, labels |
| `--color-text-secondary` | `text-secondary` | Supporting text |
| `--color-text-muted` | `text-muted` | Disabled, placeholder |

### Accent (Brand)

| Token | Tailwind class | Description |
|---|---|---|
| `--color-accent` | `text-accent` / `bg-accent` / `border-accent` | Primary brand color |
| `--color-accent-hover` | `bg-accent-hover` | Accent hover state |
| `--color-accent-fg` | `text-accent-fg` | Foreground on accent backgrounds (button labels) |

### Semantic

| Token | Tailwind class | Description |
|---|---|---|
| `--color-positive` | `text-positive` / `bg-positive` / `border-positive` | Good pick, positive value, accepted trade |
| `--color-negative` | `text-negative` / `bg-negative` / `border-negative` | Risky pick, negative value, declined trade |
| `--color-info` | `text-info` / `bg-info` / `border-info` | Neutral info, in-progress state |

### Position Colors (Fixed — not themed)

Position colors are fixed across all themes for instant recognition. They use `/10` background and `/30` border opacity variants.

| Position | Color | Tailwind classes |
|---|---|---|
| QB | Amber | `text-pos-qb` / `bg-pos-qb/10` / `border-pos-qb/30` |
| RB | Blue | `text-pos-rb` / `bg-pos-rb/10` / `border-pos-rb/30` |
| WR | Emerald | `text-pos-wr` / `bg-pos-wr/10` / `border-pos-wr/30` |
| TE | Purple | `text-pos-te` / `bg-pos-te/10` / `border-pos-te/30` |
| PICK / RDP | Yellow | `text-pos-pick` / `bg-pos-pick/10` / `border-pos-pick/30` |

---

## Theme Definitions

### Ember (default)

```css
[data-theme="ember"] {
  --color-bg:             #0c0a09;
  --color-surface:        #1c1917;
  --color-surface-raised: #292524;
  --color-surface-hover:  #292524;
  --color-border:         #292524;
  --color-border-strong:  #44403c;
  --color-text-primary:   #f5f5f4;
  --color-text-secondary: #d6d3d1;
  --color-text-muted:     #78716c;
  --color-accent:         #fcd34d;
  --color-accent-hover:   #fde68a;
  --color-accent-fg:      #0c0a09;
  --color-positive:       #86efac;
  --color-negative:       #fca5a5;
  --color-info:           #93c5fd;
}
```

### Volt

```css
[data-theme="volt"] {
  --color-bg:             #0a0c10;
  --color-surface:        #0f1117;
  --color-surface-raised: #181d27;
  --color-surface-hover:  #1e2435;
  --color-border:         #1e2435;
  --color-border-strong:  #2d3748;
  --color-text-primary:   #f1f5f9;
  --color-text-secondary: #cbd5e1;
  --color-text-muted:     #64748b;
  --color-accent:         #3b82f6;
  --color-accent-hover:   #60a5fa;
  --color-accent-fg:      #ffffff;
  --color-positive:       #86efac;
  --color-negative:       #fca5a5;
  --color-info:           #93c5fd;
}
```

### Pitch

```css
[data-theme="pitch"] {
  --color-bg:             #09090b;
  --color-surface:        #111113;
  --color-surface-raised: #18181b;
  --color-surface-hover:  #27272a;
  --color-border:         #27272a;
  --color-border-strong:  #3f3f46;
  --color-text-primary:   #fafafa;
  --color-text-secondary: #d4d4d8;
  --color-text-muted:     #71717a;
  --color-accent:         #84cc16;
  --color-accent-hover:   #a3e635;
  --color-accent-fg:      #09090b;
  --color-positive:       #86efac;
  --color-negative:       #fca5a5;
  --color-info:           #93c5fd;
}
```

---

## Typography

### Font Families

- **Body**: IBM Plex Sans — all UI text, labels, descriptions
- **Headings / Stats**: IBM Plex Sans Condensed — section headers, stat callouts, pick numbers, big data values

### Rules

- All numeric content (pick numbers, values, rankings, counts) must use `font-variant-numeric: tabular-nums` — apply via the `tabular-nums` Tailwind utility.
- Use Condensed for any text that is: a stat, a rank, a pick number, a round/pick label, or a page/section title.
- Use regular weight for body/supporting text.

### Type Scale

| Role | Font | Size | Weight | Class pattern |
|---|---|---|---|---|
| Page title | Condensed | 2xl–3xl | 700 | `font-condensed text-2xl font-bold` |
| Section header | Condensed | lg–xl | 600 | `font-condensed text-lg font-semibold` |
| Stat callout | Condensed | xl–2xl | 700 | `font-condensed text-xl font-bold tabular-nums` |
| Eyebrow label | Sans | xs | 600 | `text-xs font-semibold uppercase tracking-widest text-accent` |
| Body | Sans | sm | 400 | `text-sm text-secondary` |
| Caption / meta | Sans | xs | 400 | `text-xs text-muted` |
| Data row value | Sans | sm | 500 | `text-sm font-medium tabular-nums` |

---

## Spacing & Density

Base unit: **4px**. Target: tight, minimal. Prefer `gap-1`/`gap-2` in dense lists; only use `gap-4`+ at panel/section level.

| Context | Padding | Class |
|---|---|---|
| Data row (list item) | 4px 8px | `px-2 py-1` |
| Panel header | 8px 12px | `px-3 py-2` |
| Panel body | 8px 12px | `px-3 py-2` |
| Card / section | 12px 16px | `p-3` or `px-4 py-3` |
| Modal | 16px 20px | `p-4` or `px-5 py-4` |
| Page margin | 16px–24px | `px-4 py-6` |

---

## Border Radius

Sharp and dense. Default is `rounded` (4px). Use larger radii only for modals and floating elements.

| Context | Radius | Class |
|---|---|---|
| Data rows, cells, badges | 4px | `rounded` |
| Buttons, inputs, filter pills | 4px | `rounded` |
| Cards, panels | 6px | `rounded-md` |
| Modal / dialog | 8px | `rounded-lg` |
| Full pill (theme switcher, tags) | 9999px | `rounded-full` |

---

## Component Patterns

### Panel / Card

A panel is a bordered surface containing a section of the UI (draft board, available players, pick feed).

```
border border-default bg-surface rounded-md
```

- Header: `px-3 py-2 border-b border-default flex items-center justify-between`
- Body: `px-3 py-2`
- No large drop shadows. Use `shadow-sm` at most.

### Data Row

Rows in player lists, draft boards, pick feeds, trade asset lists.

```
flex items-center gap-2 px-2 py-1 text-sm border-b border-default last:border-b-0 hover:bg-surface-hover transition-colors
```

- Rank/number column: `font-condensed tabular-nums text-muted w-6 text-right`
- Player name: `font-medium text-primary flex-1 truncate`
- Position badge: see Position Badge below
- Value/stat: `tabular-nums text-secondary text-right`

### Position Badge

Inline badge for player position. Uses fixed position colors — not themed.

```
inline-block rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide
```

| Position | Classes |
|---|---|
| QB | `border border-pos-qb/30 bg-pos-qb/10 text-pos-qb` |
| RB | `border border-pos-rb/30 bg-pos-rb/10 text-pos-rb` |
| WR | `border border-pos-wr/30 bg-pos-wr/10 text-pos-wr` |
| TE | `border border-pos-te/30 bg-pos-te/10 text-pos-te` |
| PICK | `border border-pos-pick/30 bg-pos-pick/10 text-pos-pick` |

### Button — Primary

Used for the main action on a screen (Start Draft, Submit Trade).

```
rounded bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40
```

### Button — Secondary / Ghost

Used for supplementary actions (Save Config, View History, filters).

```
rounded border border-default px-3 py-1.5 text-sm font-medium text-secondary transition hover:border-strong hover:text-primary disabled:cursor-not-allowed disabled:opacity-40
```

### Filter Pill / Tab

Horizontal filter bar (position filters, tabs).

```
rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition
```

- Active: `bg-accent text-accent-fg`
- Inactive: `text-muted hover:text-secondary`

### Eyebrow Label

Small uppercase label above a section title or data block.

```
text-xs font-semibold uppercase tracking-widest text-accent
```

### Status Badge

Pill-shaped badge for draft status, trade status, scoring format.

```
rounded border border-default px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted
```

Semantic variants: replace `border-default text-muted` with `border-positive text-positive`, `border-negative text-negative`, or `border-info text-info`.

### Separator / Divider

```
h-px w-full bg-border
```

No gradient decorations. Keep it simple.

### Modal / Dialog

```
bg-surface-raised border border-strong rounded-lg p-4 shadow-lg
```

Overlay backdrop: `bg-black/60 backdrop-blur-sm`

### Collapsed Column Strip

Collapsed panel state in the draft layout.

```
flex h-full w-full items-center justify-center rounded-md border border-default bg-surface text-muted transition hover:border-strong hover:text-secondary cursor-pointer
```

### Draft Status Bar

Full-width bar above the draft columns.

```
w-full rounded-md border border-default bg-surface px-3 py-2
```

### Theme Switcher

Persistent element in the app header. Renders the three theme options as labeled buttons.

```
flex items-center gap-1 rounded border border-default p-0.5
```

Each option: `rounded px-2 py-1 text-xs font-medium transition` — active: `bg-accent text-accent-fg`, inactive: `text-muted hover:text-secondary`

---

## Layout

- **Page container**: `min-h-screen bg-app px-4 py-6`
- **Content max-width**: `max-w-7xl mx-auto`
- **Draft layout**: CSS grid, three columns. Default ratio `2fr 1.5fr 1fr`; expands to `4fr 0.45fr 0.45fr` when one column is focused.
- **Column gap**: `gap-3` (12px)
- **Section gap**: `gap-2` (8px) within panels, `gap-3` between panels

---

## Do & Don't

| Do | Don't |
|---|---|
| Use semantic token classes (`text-accent`, `bg-surface`) | Hardcode palette classes (`text-amber-300`, `bg-stone-900`) |
| Use `font-condensed` + `tabular-nums` for all stat values | Use regular weight sans for big numbers |
| Use `rounded` or `rounded-md` | Use `rounded-[2rem]` or `rounded-full` on cards |
| Keep padding tight (`px-2 py-1` for rows) | Add generous padding to chase a "modern SaaS" feel |
| Use `border-default` for structural borders | Use decorative gradient separators |
| Let data density speak | Add decorative elements, gradients, or large drop shadows |
