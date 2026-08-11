# Multi-tenant Isolation Plan

Implement strict user-based isolation to ensure that every tenant (user) can only access their own data and files.

## User Review Required

> [!IMPORTANT]
> This plan assumes that a "tenant" is equivalent to a single user (`auth.uid()`). If your tenants are organizations with multiple users, we should add an `organization_id` column instead.

- **Storage**: The `dani` bucket is already isolated by owner. I will apply similar isolation to other buckets if they exist.
- **Database**: I will add an `owner_id` column to tables like `projects`, `units`, `clients`, etc., and update RLS to filter by this ID.

## Proposed Changes

### Database

#### Migration: Add Ownership and Refine RLS
- Add `owner_id` (UUID) to `projects`, `units`, `clients`, `dealers`, `bookings`, `payments`, `adjustments`, `installment_ledger`, `notices`, `booking_documents`.
- Update RLS policies for these tables to restrict `SELECT`, `INSERT`, `UPDATE`, `DELETE` to `auth.uid() = owner_id`.
- For `profiles` and `user_roles`, maintain existing isolation (users see only themselves unless they are admins).

### Storage

#### Policy Update
- Ensure all storage buckets use path-based isolation (e.g., `bucket/user-uuid/*`) or have RLS policies checking file ownership.

## Technical Details

- **Tables to update**: `projects`, `units`, `clients`, `dealers`, `bookings`, `payments`, `adjustments`, `installment_ledger`, `notices`, `booking_documents`.
- **Function changes**: Ensure `has_role` and `is_writer` do not bypass tenancy checks when called.

## Security Considerations

- **Admins**: If global admins need cross-tenant visibility, policies will include `OR has_role(auth.uid(), 'admin')`.
- **Existing Data**: Data without an `owner_id` will need to be assigned to the initial creator or remain inaccessible until updated.
