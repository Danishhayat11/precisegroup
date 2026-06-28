CREATE TABLE public.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no text NOT NULL UNIQUE,
  booking_id text NOT NULL REFERENCES public.bookings(booking_id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'legal_notice',
    'final_legal_notice',
    'final_legal_notice_cancellation',
    'cancellation_notice'
  )),
  notice_date date NOT NULL DEFAULT CURRENT_DATE,
  deadline_date date,
  previous_notice_date date,
  previous_notice_2_date date,
  unit_no text,
  serial int NOT NULL,
  year int NOT NULL,
  channel text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','delivered')),
  client_title text,
  overdue_amount numeric DEFAULT 0,
  overdue_count int DEFAULT 0,
  body jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notices_booking ON public.notices(booking_id);
CREATE INDEX idx_notices_created ON public.notices(created_at DESC);
CREATE INDEX idx_notices_doc_type ON public.notices(doc_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notices TO authenticated;
GRANT ALL ON public.notices TO service_role;

ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notices_read" ON public.notices
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "notices_write" ON public.notices
  FOR INSERT TO authenticated WITH CHECK (public.is_writer(auth.uid()));

CREATE POLICY "notices_update" ON public.notices
  FOR UPDATE TO authenticated USING (public.is_writer(auth.uid()));

CREATE POLICY "notices_delete" ON public.notices
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER t_notices_upd
  BEFORE UPDATE ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.next_notice_serial(_booking_id text, _year int)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(serial), 0) + 1
  FROM public.notices
  WHERE booking_id = _booking_id AND year = _year;
$$;

GRANT EXECUTE ON FUNCTION public.next_notice_serial(text, int) TO authenticated;