-- Add owner_id to all tables
DO $$
BEGIN
    ALTER TABLE public.projects ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
    ALTER TABLE public.units ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
    ALTER TABLE public.clients ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
    ALTER TABLE public.dealers ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
    ALTER TABLE public.bookings ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
    ALTER TABLE public.payments ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
    ALTER TABLE public.adjustments ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
    ALTER TABLE public.installment_ledger ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
    ALTER TABLE public.notices ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
    ALTER TABLE public.booking_documents ADD COLUMN owner_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

-- Drop existing broad policies and create restrictive ones
-- Projects
DROP POLICY IF EXISTS projects_read ON public.projects;
DROP POLICY IF EXISTS projects_write ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
DROP POLICY IF EXISTS projects_delete ON public.projects;

CREATE POLICY "projects_select_own" ON public.projects FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "projects_insert_own" ON public.projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "projects_update_own" ON public.projects FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "projects_delete_own" ON public.projects FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Units
DROP POLICY IF EXISTS units_read ON public.units;
DROP POLICY IF EXISTS units_write ON public.units;
DROP POLICY IF EXISTS units_update ON public.units;
DROP POLICY IF EXISTS units_delete ON public.units;

CREATE POLICY "units_select_own" ON public.units FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "units_insert_own" ON public.units FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "units_update_own" ON public.units FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "units_delete_own" ON public.units FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Clients
DROP POLICY IF EXISTS clients_read ON public.clients;
DROP POLICY IF EXISTS clients_write ON public.clients;
DROP POLICY IF EXISTS clients_update ON public.clients;
DROP POLICY IF EXISTS clients_delete ON public.clients;

CREATE POLICY "clients_select_own" ON public.clients FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "clients_insert_own" ON public.clients FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "clients_update_own" ON public.clients FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "clients_delete_own" ON public.clients FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Dealers
DROP POLICY IF EXISTS dealers_read ON public.dealers;
DROP POLICY IF EXISTS dealers_write ON public.dealers;

CREATE POLICY "dealers_select_own" ON public.dealers FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "dealers_insert_own" ON public.dealers FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "dealers_update_own" ON public.dealers FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "dealers_delete_own" ON public.dealers FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Bookings
DROP POLICY IF EXISTS bookings_read ON public.bookings;
DROP POLICY IF EXISTS bookings_write ON public.bookings;
DROP POLICY IF EXISTS bookings_update ON public.bookings;
DROP POLICY IF EXISTS bookings_delete ON public.bookings;

CREATE POLICY "bookings_select_own" ON public.bookings FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "bookings_insert_own" ON public.bookings FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "bookings_update_own" ON public.bookings FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "bookings_delete_own" ON public.bookings FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Payments
DROP POLICY IF EXISTS pay_read ON public.payments;
DROP POLICY IF EXISTS pay_write ON public.payments;
DROP POLICY IF EXISTS pay_update ON public.payments;
DROP POLICY IF EXISTS pay_delete ON public.payments;

CREATE POLICY "payments_select_own" ON public.payments FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "payments_insert_own" ON public.payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "payments_update_own" ON public.payments FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "payments_delete_own" ON public.payments FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Adjustments
DROP POLICY IF EXISTS adj_read ON public.adjustments;
DROP POLICY IF EXISTS adj_write ON public.adjustments;
DROP POLICY IF EXISTS adj_update ON public.adjustments;
DROP POLICY IF EXISTS adj_delete ON public.adjustments;

CREATE POLICY "adjustments_select_own" ON public.adjustments FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "adjustments_insert_own" ON public.adjustments FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "adjustments_update_own" ON public.adjustments FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "adjustments_delete_own" ON public.adjustments FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Installment Ledger
DROP POLICY IF EXISTS led_read ON public.installment_ledger;
DROP POLICY IF EXISTS led_write ON public.installment_ledger;
DROP POLICY IF EXISTS led_update ON public.installment_ledger;
DROP POLICY IF EXISTS led_delete ON public.installment_ledger;

CREATE POLICY "ledger_select_own" ON public.installment_ledger FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "ledger_insert_own" ON public.installment_ledger FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "ledger_update_own" ON public.installment_ledger FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "ledger_delete_own" ON public.installment_ledger FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Notices
DROP POLICY IF EXISTS notices_read ON public.notices;
DROP POLICY IF EXISTS notices_write ON public.notices;
DROP POLICY IF EXISTS notices_update ON public.notices;
DROP POLICY IF EXISTS notices_delete ON public.notices;

CREATE POLICY "notices_select_own" ON public.notices FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "notices_insert_own" ON public.notices FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "notices_update_own" ON public.notices FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "notices_delete_own" ON public.notices FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Booking Documents
DROP POLICY IF EXISTS "authenticated read booking_documents" ON public.booking_documents;
DROP POLICY IF EXISTS "writers insert booking_documents" ON public.booking_documents;
DROP POLICY IF EXISTS "writers update booking_documents" ON public.booking_documents;
DROP POLICY IF EXISTS "writers delete booking_documents" ON public.booking_documents;

CREATE POLICY "documents_select_own" ON public.booking_documents FOR SELECT TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "documents_insert_own" ON public.booking_documents FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "documents_update_own" ON public.booking_documents FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "documents_delete_own" ON public.booking_documents FOR DELETE TO authenticated USING (auth.uid() = owner_id OR has_role(auth.uid(), 'admin'));

-- Storage Policies for other buckets if any
-- Assuming 'booking-documents' bucket exists
DROP POLICY IF EXISTS "booking-documents" ON storage.objects;
CREATE POLICY "booking-documents_owner_access" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'booking-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'booking-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
