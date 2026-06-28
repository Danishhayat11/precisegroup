
DROP POLICY IF EXISTS "authenticated insert booking_documents" ON public.booking_documents;
DROP POLICY IF EXISTS "authenticated update booking_documents" ON public.booking_documents;
DROP POLICY IF EXISTS "authenticated delete booking_documents" ON public.booking_documents;

CREATE POLICY "writers insert booking_documents"
  ON public.booking_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "writers update booking_documents"
  ON public.booking_documents FOR UPDATE TO authenticated
  USING (public.is_writer(auth.uid())) WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "writers delete booking_documents"
  ON public.booking_documents FOR DELETE TO authenticated
  USING (public.is_writer(auth.uid()));

DROP POLICY IF EXISTS "booking-documents insert" ON storage.objects;
DROP POLICY IF EXISTS "booking-documents update" ON storage.objects;
DROP POLICY IF EXISTS "booking-documents delete" ON storage.objects;

CREATE POLICY "booking-documents insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'booking-documents' AND public.is_writer(auth.uid()));
CREATE POLICY "booking-documents update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'booking-documents' AND public.is_writer(auth.uid()))
  WITH CHECK (bucket_id = 'booking-documents' AND public.is_writer(auth.uid()));
CREATE POLICY "booking-documents delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'booking-documents' AND public.is_writer(auth.uid()));
