## Goal

Add a single-page A4 "Client Payment History" printable document that lists every payment a client has made against their unit, with a totals block, signature lines, and the same dual letterhead system already used by other documents. Wire it into four entry points.

## Deliverables

### 1. New component: `src/components/PaymentHistoryDocument.tsx`
Pure presentational component that renders the full A4 page given a booking, its payments, and on-screen filter state. Sections per the spec:

1. Letterhead (reuses the existing `PrintPreviewModal` letterhead switcher — Precise default, Dani alternate)
2. Title: "CLIENT PAYMENT HISTORY" + "Statement of Payments Received"
3. Two-column client + unit info block
4. Navy contract summary bar (Contract value | Received | Remaining)
5. Payments table (9 cols, sorted ascending by date, color-coded by type, JetBrains Mono for receipt + amounts, running balance, optional subtotal rows when both Down Payment + Installment exist, light-purple row tint for Adjustment/Asset)
6. Totals block (breakdown left, balance right, "✓ FULLY PAID" green if 0)
7. Notes box (only if any payment has notes or any adjustment exists)
8. Signature block (Verified By / Client Acknowledgment)
9. Footer (existing gold divider + contact + disclaimer)

**One-page enforcement** — count payment rows up front and pick a tier:

```text
1–8   rows: row 8mm, font 9.5pt, totals 20mm
9–14  rows: row 7mm, font 9pt,  totals 18mm
15–20 rows: row 6mm, font 8.5pt, compact totals
21+   rows: split — page 1 "Page 1 of 2", page 2 continuation header + remaining rows + totals
```

Applied via a `tier` variable that selects Tailwind/inline-style values; no runtime measurement.

**Data rules (locked):**
- Cash + Bank Transfer → counted in "Total Cash + Bank"
- Adjustment/Asset → shown in table with purple tint, NEVER added to cash/bank totals; surfaced separately as "Adjustment Credit Applied"
- Running balance = contract_value − cumulative (cash + bank + adjustment credit)
- Overdue amount + count read from `installment_ledger` for this booking (overdue rows where due_date < today and not fully paid)

### 2. New host page: `src/pages/PaymentHistoryView.tsx` (route `/payment-history/:bookingId`)
- Loads booking, client, unit, payments, installment_ledger via existing supabase patterns
- On-screen filter bar (hidden from print via existing `.print:hidden` pattern):
  - Date range From / To (filters which payments render)
  - "Show adjustment payments" toggle (default on)
  - "Show remarks column" toggle (default on)
- Quick stats bar (screen only): Total Payments, Cash total, Last Payment date, Days Since Last (+ orange badge >90, red badge >180)
- If a date range filter is active, render a note line in the printed body: "* This statement shows payments from [FROM] to [TO] only. Full payment history available on request."
- Letterhead switcher (existing dual switcher) above the preview
- "Print" button → `window.print()` via existing `src/lib/print.ts` helper

### 3. Entry points
| Location | Element | Action |
|----------|---------|--------|
| `BookingDetail` Payments tab | Top-right button "Print Payment History" | Navigate to `/payment-history/{bookingId}` |
| `DocumentCenter` (after a booking is selected) | New `DocumentList` (currently a placeholder card) — item #3 "Payment History" | Same nav |
| `Reports` per-client rows | Small "Print Client Statement" button | Same nav |
| `Bookings` list rows | Printer icon button with tooltip "Print Payment History" | Same nav |

The `DocumentCenter` currently has a placeholder where the doc menu will go. I'll replace that placeholder with a minimal list whose only live entry today is "Payment History" (slot #3 reserved as specified); other entries render as disabled placeholders so the numbering matches the spec.

### 4. Reused infrastructure (no new versions)
- Letterhead switcher + safe-area logic from `PrintPreviewModal` — extracted into a small `LetterheadFrame` wrapper if needed, otherwise reused inline
- `src/lib/print.ts` for the actual print trigger
- `src/lib/format.ts` `fmtPKR` + `fmtDate` for all currency/date rendering
- JetBrains Mono via the existing font stack already used in PaymentReceipt

## Out of scope (will NOT touch this turn)
- Editing the Agreement / Allotment / Payment Plan / Receipt templates
- Changing audit logging or RLS on payments
- Adding a new database table

## File touch list
- NEW `src/components/PaymentHistoryDocument.tsx`
- NEW `src/pages/PaymentHistoryView.tsx`
- EDIT `src/App.tsx` (add route)
- EDIT `src/pages/BookingDetail.tsx` (button on Payments tab)
- EDIT `src/pages/DocumentCenter.tsx` (replace placeholder with doc list)
- EDIT `src/pages/Reports.tsx` (per-row button)
- EDIT `src/pages/Bookings.tsx` (printer icon per row)
- NEW `src/pages/PaymentHistoryDocument.test.tsx` (totals math + tier selection + adjustment-not-in-cash invariant)

## Open questions before I implement

1. **Document Center doc menu.** The current `DocumentCenter` page has a placeholder note ("Document menu … will appear here once Section C is wired up") — the 9-doc list does not exist yet. Do you want me to (a) scaffold the full numbered list with Payment History live and the rest disabled, or (b) just add a single "Payment History" entry until the rest is built?

2. **Overdue figures.** The spec asks for "Overdue Amount" and "Overdue Installments" count. Confirm I should read these from `installment_ledger` (rows where `due_date < today` and `paid_amount < amount_due`). If you have a different definition, name it.

3. **Reports page row identity.** "Per-client section" — does that mean one row per booking (so the print button takes you to that booking's payment history), or one row per client (in which case I need a client→booking picker)? I'll assume **per-booking** unless you say otherwise.

4. **Adjustment "asset description" field.** For the Bank/Ref column on Adjustment rows the spec says "show asset description (first 25 chars)". I'll source this from `payments.notes` truncated to 25 chars — confirm or point me at a different column.

Approve with answers (or "go with your defaults") and I'll build it end-to-end.