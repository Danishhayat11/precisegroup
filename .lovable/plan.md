# Document Vault

A per-booking file vault: upload PDFs/images/Word docs, label them, list/search/preview/download/delete, with dashboard badges and a one-click "Mark as Sent via TCS" hook on the legal-notice page.

## 1. Storage

- Create a **private** Supabase Storage bucket `booking-documents`.
- Path convention: `bookings/<booking_id>/<uuid>.<ext>`.
- RLS on `storage.objects`:
  - `SELECT` / `INSERT` / `DELETE`: authenticated users (matches the rest of the app's staff-write model).
- 10 MB max enforced client-side before upload; allowed mime types: PDF, JPG, PNG, DOCX.

## 2. New table `public.booking_documents`

Columns (domain-specific only):
- `booking_id` (text, FK → bookings.booking_id, on delete cascade)
- `label` (text — one of the fixed dropdown values, or `Other`)
- `label_custom` (text, nullable — used when label = `Other`)
- `document_date` (date)
- `notes` (text, nullable)
- `storage_path` (text — object path in `booking-documents`)
- `file_name` (text — original filename)
- `mime_type` (text)
- `size_bytes` (bigint)
- `uploaded_by` (uuid → auth.users, nullable)
- `uploaded_by_name` (text, nullable — denormalized for display)
- `source` (text, default `manual`) — set to `legal_notice_tcs` for quick-upload entries
- `tcs_tracking_no` (text, nullable)
- standard `id`, `created_at`, `updated_at`

Grants + RLS:
- `GRANT SELECT, INSERT, UPDATE, DELETE` to `authenticated`; `GRANT ALL` to `service_role`.
- RLS enabled. Policies: authenticated can select/insert/update/delete (consistent with existing booking-data tables).

## 3. Components

- `src/components/DocumentVault.tsx` — the main panel, embedded inside `BookingDetail`.
  - Upload button → file picker → modal asking Label (Select), Custom label input (only when `Other`), Date, Notes → uploads to storage, inserts row.
  - List table: Label | File Name | Size | Date | Uploaded By | Notes | Preview | Download | Delete (with confirm).
  - Total count line: "N documents on file".
  - Search input + label filter dropdown.
  - File-type icon (PDF / Word / Image) based on mime.
  - Inline preview: PDFs and images open in a Dialog using a signed URL.

- `src/lib/bookingDocuments.ts` — helpers: `listDocs`, `uploadDoc`, `deleteDoc`, `signedUrl`, `LABEL_OPTIONS`, size/icon utils.

## 4. Booking list badges (`src/pages/Bookings.tsx`)

- Fetch per-booking doc counts + presence of `Agreement to Sell` and `Client CNIC Copy` in one query (group by booking_id).
- New column "Docs":
  - Count badge (e.g. `12`).
  - **Red** if Agreement to Sell missing.
  - **Green** if both Agreement and CNIC present.
  - Neutral otherwise.

## 5. Legal-notice quick upload (`src/pages/Documents.tsx` / DocumentView)

- After Print/Download, show a "Mark as Sent via TCS" button.
- Opens a small dialog: TCS tracking number (required).
- Action: render the notice to PDF (reuse existing print pipeline → `html2pdf`/blob), upload to `booking-documents`, insert `booking_documents` row with:
  - `label = 'Legal Notice Sent'` (or Final/Cancellation per notice type)
  - `document_date = today`
  - `notes = 'TCS tracking: <no>'`
  - `tcs_tracking_no`, `source = 'legal_notice_tcs'`
- Also updates the existing `notices` row `status = 'Sent'`, `channel = 'TCS'`.

## 6. Constants

```ts
LABEL_OPTIONS = [
  "Agreement to Sell / Booking Form",
  "Client CNIC Copy",
  "Client Photo",
  "Payment Receipt (Scanned)",
  "Legal Notice Sent",
  "Final Legal Notice Sent",
  "Cancellation Notice Sent",
  "Client Reply / Response Received",
  "Court Letter / Legal Correspondence",
  "Cheque Copy",
  "Bank Transfer Slip",
  "Allotment Letter (Signed Copy)",
  "Possession Letter (Signed Copy)",
  "Transfer Form (Signed)",
  "NOC / Clearance Certificate",
  "Affidavit",
  "Other",
];
MANDATORY = ["Agreement to Sell / Booking Form"];
GREEN_REQUIRES = ["Agreement to Sell / Booking Form", "Client CNIC Copy"];
```

## Order of execution

1. Migration: bucket policies + `booking_documents` table.
2. Library helpers + types.
3. `DocumentVault` component + integrate into `BookingDetail`.
4. Bookings list badges.
5. Legal-notice "Mark as Sent via TCS" hook.

## Out of scope (call out)

- Versioning / replace-in-place — delete + re-upload instead.
- Bulk upload / drag-multi — one file at a time per the spec.
- OCR / content search — search is on label/filename/notes only.
