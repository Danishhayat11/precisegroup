
-- Tighten profiles SELECT: users see own profile; admins/managers see all
DROP POLICY IF EXISTS profiles_select_auth ON public.profiles;
CREATE POLICY profiles_select_self_or_admin ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

-- Tighten user_roles SELECT: users see own roles; admins see all
DROP POLICY IF EXISTS roles_select_auth ON public.user_roles;
CREATE POLICY roles_select_self_or_admin ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- Lock audit_logs INSERT to actor = auth.uid()
DROP POLICY IF EXISTS audit_insert ON public.audit_logs;
CREATE POLICY audit_insert_self ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (actor_id = auth.uid());

-- Restrict audit_logs SELECT to admins
DROP POLICY IF EXISTS audit_read ON public.audit_logs;
CREATE POLICY audit_read_admin ON public.audit_logs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(),'admin'));

-- Revoke EXECUTE on SECURITY DEFINER helpers from authenticated; keep server-side use
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- Storage RLS for private 'dani' bucket: only owner can access their files
DROP POLICY IF EXISTS "dani_select_own" ON storage.objects;
DROP POLICY IF EXISTS "dani_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "dani_update_own" ON storage.objects;
DROP POLICY IF EXISTS "dani_delete_own" ON storage.objects;

CREATE POLICY "dani_select_own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'dani' AND owner = auth.uid());
CREATE POLICY "dani_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'dani' AND owner = auth.uid());
CREATE POLICY "dani_update_own" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'dani' AND owner = auth.uid())
WITH CHECK (bucket_id = 'dani' AND owner = auth.uid());
CREATE POLICY "dani_delete_own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'dani' AND owner = auth.uid());
