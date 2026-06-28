
CREATE TABLE public.booking_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id text NOT NULL REFERENCES public.bookings(booking_id) ON DELETE CASCADE,
  label text NOT NULL,
  label_custom text,
  document_date date NOT NULL DEFAULT (now()::date),
  notes text,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  uploaded_by uuid,
  uploaded_by_name text,
  source text NOT NULL DEFAULT 'manual',
  tcs_tracking_no text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_documents_booking_id_idx ON public.booking_documents(booking_id);
CREATE INDEX booking_documents_label_idx ON public.booking_documents(label);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_documents TO authenticated;
GRANT ALL ON public.booking_documents TO service_role;

ALTER TABLE public.booking_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read booking_documents"
  ON public.booking_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert booking_documents"
  ON public.booking_documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update booking_documents"
  ON public.booking_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated delete booking_documents"
  ON public.booking_documents FOR DELETE TO authenticated USING (true);

CREATE TRIGGER booking_documents_set_updated_at
  BEFORE UPDATE ON public.booking_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage policies for the booking-documents bucket
CREATE POLICY "booking-documents read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'booking-documents');
CREATE POLICY "booking-documents insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'booking-documents');
CREATE POLICY "booking-documents update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'booking-documents') WITH CHECK (bucket_id = 'booking-documents');
CREATE POLICY "booking-documents delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'booking-documents');
