ALTER TABLE public.booking_documents
  ADD COLUMN IF NOT EXISTS sent_via text,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_to text;

ALTER TABLE public.booking_documents
  DROP CONSTRAINT IF EXISTS booking_documents_sent_via_check;

ALTER TABLE public.booking_documents
  ADD CONSTRAINT booking_documents_sent_via_check
  CHECK (sent_via IS NULL OR sent_via IN ('TCS Courier','WhatsApp','Both','Email','In Person'));