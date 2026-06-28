import { supabase } from "@/integrations/supabase/client";

export type DocAuditAction =
  | "document.draft.edit"
  | "document.draft.save"
  | "document.draft.reset"
  | "document.print"
  | "document.download";

export interface DocAuditPayload {
  action: DocAuditAction;
  documentType: string;
  referenceNo?: string | null;
  bookingId?: string | null;
  extra?: Record<string, any>;
}

/**
 * Log a document-related action to audit_logs.
 * Captures actor (from current session) + document type, reference no, booking id.
 * Fails silently — auditing must never break user flow.
 */
export async function logDocumentAction(p: DocAuditPayload): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let actor_email: string | null = user.email ?? null;
    let full_name: string | null = null;
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (prof) {
        actor_email = prof.email ?? actor_email;
        full_name = (prof as any).full_name ?? null;
      }
    } catch { /* ignore */ }

    await supabase.from("audit_logs").insert({
      actor_id: user.id,
      actor_email,
      action: p.action,
      entity: "document",
      entity_id: p.referenceNo || p.bookingId || null,
      after: {
        document_type: p.documentType,
        reference_no: p.referenceNo ?? null,
        booking_id: p.bookingId ?? null,
        actor_full_name: full_name,
        ...(p.extra ?? {}),
      },
    });
  } catch {
    /* swallow */
  }
}

// Debounce edit logs so we don't spam the table on every keystroke.
const editTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function logDocumentEditDebounced(p: DocAuditPayload, delayMs = 2500) {
  const key = `${p.bookingId ?? ""}::${p.documentType}`;
  const existing = editTimers.get(key);
  if (existing) clearTimeout(existing);
  editTimers.set(
    key,
    setTimeout(() => {
      editTimers.delete(key);
      void logDocumentAction(p);
    }, delayMs),
  );
}
