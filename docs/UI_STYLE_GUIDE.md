# UI Style Guide

This project uses a simple, data-first interface style.

## Principles

1. Keep information dense but readable.
2. Use neutral surfaces and one primary accent.
3. Avoid decorative complexity in monitoring views.
4. Prioritize fast scanning of status, trend, and incident state.

## Tokens

1. Text:
- Primary: `#0f172a`
- Secondary: `#64748b`

2. Surface:
- Page background: `#f8fafc`
- Card background: `#ffffff`
- Border: `#dbe2ea` or `#e5e7eb`

3. Accent:
- Primary action: `#0ea5a2`
- Primary hover: `#0b8a87`

4. State colors:
- Success: `#166534` on `#dcfce7`
- Warning: `#92400e` on `#fef3c7`
- Danger: `#b91c1c`

## Typography

1. Base family: Manrope, IBM Plex Sans, Segoe UI, sans-serif.
2. Use clear hierarchy:
- Page title: 2.2rem
- Section title: 1.5rem
- Body: 1rem
- Meta labels: 0.84rem to 0.9rem

## Components

1. Buttons
- `.btn-primary` for create/confirm actions.
- `.btn-secondary` for neutral actions (paging, toggles).
- `.btn-danger` for destructive actions.
- `.btn-compact` for table-row actions.

2. Tables
- Use `.data-table` and `.obs-table` patterns.
- Header row uses uppercase small labels.
- Right-align numeric columns with utility class (`.text-right` or `.obs-right`).

3. Filters and controls
- Use `.section-controls` + `.filter-control` in detail pages.
- Keep pagination controls grouped in `.controls-pagination`.

## Spacing and layout

1. Standard spacing increments: 0.5rem, 0.75rem, 1rem, 1.5rem, 2rem.
2. Keep card radius between 8px and 12px.
3. Use 1px borders and light shadows for separation.

## Responsiveness

1. Collapse toolbar and filter rows under 768px.
2. Convert 4-column stat grids to 2 columns at tablet and 1 column on small phones.
3. Ensure action menus and inputs expand to full width on mobile.

## Usage notes

1. Prefer CSS classes over inline styles.
2. Add new styles to page stylesheet first, then extract to shared patterns when repeated.
3. Keep UI changes visual only unless explicitly requested to change behavior.
