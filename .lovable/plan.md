## Goal
Replace the current "open new tab → browser print dialog" flow with an in-app **Print Preview Modal** that renders the document exactly as it will print on the A4 letterhead — with real line wrapping, multi-page splits, and a Print button that triggers the actual print.

## Where it plugs in
1. **BookingDocumentEditor** (`src/components/BookingDocumentEditor.tsx`) — the Print button currently calls `printOnLetterhead(...)` which spawns a new tab. Switch it to open the new modal.
2. **DocumentView** (`src/pages/DocumentView.tsx`) — the Print/PDF button currently calls `window.print()` directly. Switch it to open the same modal, passing the document's rendered JSX as children.

## New component: `src/components/PrintPreviewModal.tsx`
A shadcn `Dialog` (full-screen on small screens, ~ A4+padding on desktop) that contains:

- **Header bar** — title, page count indicator ("Page 1 of N"), Zoom controls (50% / 75% / 100% / Fit), Close, and a primary **Print** button.
- **Preview canvas** — gray background, centered stack of A4 "sheets". Each sheet is a `210mm × 297mm` div with:
  - The letterhead JPG as background (same URL/sizing as `printOnLetterhead`).
  - The same safe content area padding `58mm 22mm 38mm 24mm`.
  - The body content inside.
- **Pagination engine** — measures the rendered body and splits it across multiple A4 sheets so the user sees the exact page breaks before printing.

### Pagination approach
Two modes, picked by the caller:

- **`mode: "text"`** (used by BookingDocumentEditor): body is a long pre-wrapped string.
  - Render into an off-screen measuring div sized to the safe content width with the exact print font (`Times New Roman 11.5pt / line-height 1.55`).
  - Walk children/line-boxes and accumulate height until it exceeds the safe content height (`297 − 58 − 38 = 201mm`), then start a new page. Splits happen on line boundaries, never mid-line.
- **`mode: "react"`** (used by DocumentView): body is JSX (tables, grids, signatures).
  - Render the JSX once into a hidden measuring container at the safe content width.
  - Walk top-level block children (`.pp-block` wrappers) and group them into pages by accumulated `offsetHeight`. Tables get `break-inside: avoid` on `<tr>` so rows don't split awkwardly; long tables are allowed to span pages because each `<tr>` is its own measurable block when we flatten one level into the table.
  - Simpler v1: group by direct children only and rely on CSS `break-inside: avoid` for tables. Acceptable because real bookings produce ≤ 1–2 pages.

### Printing
Clicking Print injects a print-only stylesheet that:
- Hides everything (`body > *:not(.pp-print-root) { display: none }`).
- Sets `@page { size: A4; margin: 0 }`.
- Shows the preview sheets at 100% (overrides the on-screen zoom transform).
- Calls `window.print()`, then removes the stylesheet on `afterprint`.

This keeps the preview the source of truth — no second renderer, no new-tab popup, no popup-blocker issues.

## Wiring changes

- **`BookingDocumentEditor.handlePrint`** → open modal with `mode: "text"`, body = current `text` (with the letterhead-prefix strip preserved), title = `${type} — ${booking.booking_id}`.
- **`DocumentView`** → wrap the existing `letterhead-page` JSX into the modal as `mode: "react"` children. Top Print button opens the modal. Keep the on-page preview as today (or remove it — see Open question).
- **`src/lib/print.ts`** → keep `LETTERHEAD_URL` and the safe-area constants exported (modal imports them). `printOnLetterhead` can stay for now as a fallback but is no longer the primary path.
- **`src/index.css`** → add the `@media print` rules scoped to `.pp-print-root` (the multi-page stack).

## Technical details

```text
A4 sheet:           210mm × 297mm
Safe content area:  width = 210 − 22 − 24 = 164mm
                    height = 297 − 58 − 38 = 201mm
Font (print):       Times New Roman, 11.5pt, line-height 1.55
Zoom (screen only): CSS transform scale on the sheets; layout math stays in mm
```

Measuring container is `position: fixed; left: -10000px; width: 164mm;` with the same font stack so `getBoundingClientRect()` returns true print pixels (1mm = 3.7795px at 96dpi — we read computed heights, not assumed ones).

## Open question
In `DocumentView`, do you want to **keep the always-visible on-page A4 preview** and have the modal open on top of it, or **remove the in-page preview entirely** and only show the document inside the modal (cleaner, less duplication)? I'll default to keeping the in-page preview unless you say otherwise.
