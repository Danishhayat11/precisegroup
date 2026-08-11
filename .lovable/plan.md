# Security Remediation Plan

Fixing security findings from the latest scan results, including database RLS hardening and dependency updates.

## User Review Required

> [!IMPORTANT]
> - Database migrations will tighten access to `profiles`, `user_roles`, and `audit_logs`.
> - Dependency updates for `react-router-dom` and `recharts` will be applied to resolve XSS and Prototype Pollution vulnerabilities.

- **Storage**: The `dani` bucket will have RLS policies applied to restrict access to file owners only.
- **Profiles & Roles**: Authenticated users will no longer be able to read all profiles and roles; access will be restricted to self-profile/roles or admin/manager roles.
- **Audit Logs**: Users can only insert audit logs where they are the actor, and only admins can read audit logs.
- **Functions**: Revoking `EXECUTE` on sensitive `SECURITY DEFINER` functions from authenticated users.

## Technical Details

### Database Migrations
1. **Fix SECURITY DEFINER EXECUTE**:
   - `REVOKE EXECUTE ON FUNCTION public.has_role` from `authenticated`.
   - `REVOKE EXECUTE ON FUNCTION public.is_writer` from `authenticated`.
2. **Fix Storage RLS**:
   - Create RLS policies for the `dani` bucket in `storage.objects`.
3. **Tighten Data Policies**:
   - Update `profiles` SELECT policy to `(auth.uid() = id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))`.
   - Update `user_roles` SELECT policy to `(auth.uid() = user_id OR public.has_role(auth.uid(),'admin'))`.
   - Update `audit_logs` INSERT policy to `WITH CHECK (actor_id = auth.uid())`.

### Dependency Updates
- Update `react-router-dom` to the latest `6.x` (target `^6.30.1` -> `^6.30.2` or higher if available).
- Update `recharts` to the latest `2.x` (target `^2.15.4` -> `^2.15.5` or higher).

### Security Memory
- Update `@security-memory` to reflect these hardened policies and prevent regressions.
