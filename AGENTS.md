# AGENTS.md

Project instructions for coding agents working in this repository.

## Linked-Intent Development

This repository uses the centralized Linked Intent Development skill in [`LID.md`](LID.md).
Follow `LID.md` as the source of truth for the LID workflow, approval gates, traceability, and bug-fix protocol.

### README Maintenance

When completing any feature or issue, update `README.md` to reflect changes: new setup steps, changed commands, new configuration options, or new components. Keep it accurate and current — it is the primary quick-start reference.

### Navigation

| What you need | Where to look |
|---|---|
| High-level design | `docs/high-level-design.md` |
| Low-level designs | `docs/llds/` |
| EARS specs | `docs/specs/` |
| UI design system | `DESIGN.md` |

## UI Development

This project uses a design system defined in [`DESIGN.md`](DESIGN.md). **Read `DESIGN.md` before writing or modifying any UI component.**

Rules enforced by the design system:

- Use semantic Tailwind token classes (`text-accent`, `bg-surface`, `border-default`) — never hardcode palette classes like `text-amber-300` or `bg-stone-900`.
- Use `font-condensed` + `tabular-nums` for all stat values, pick numbers, and section headers.
- Use `rounded` (4px) for rows/buttons/badges, `rounded-md` (6px) for panels/cards, `rounded-lg` (8px) for modals. Never use `rounded-[2rem]` or large decorative radii on structural elements.
- Keep padding tight: `px-2 py-1` for data rows, `px-3 py-2` for panel headers/bodies.
- Position badge colors (QB/RB/WR/TE/PICK) are fixed across themes — use `text-pos-qb`, `bg-pos-qb`, `border-pos-qb`, etc.
- All accent, surface, border, and text colors must come from the CSS variable token layer defined in `DESIGN.md`.
