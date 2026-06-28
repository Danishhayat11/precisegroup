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

/**
 * Log a blocked payment save (Adjustment/Asset trigger or other invariant).
 * Captures actor, payment id, booking id, payment mode, amount, and the
 * failed condition message from Postgres.
 */
export interface PaymentBlockedAuditEntry {
  id: string;
  actor_id: string;
  actor_email: string | null;
  actor_full_name: string | null;
  failed_condition: string;
  receipt_no: string;
  created_at: string;
}

export async function logPaymentBlocked(p: {
  receiptNo: string;
  bookingId: string;
  paymentMode: string;
  amount: number;
  failedCondition: string;
  rawError?: string;
}): Promise<PaymentBlockedAuditEntry | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

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

    const { data, error } = await supabase
      .from("audit_logs")
      .insert({
        actor_id: user.id,
        actor_email,
        action: "payment.save.blocked",
        entity: "payment",
        entity_id: p.receiptNo,
        after: {
          receipt_no: p.receiptNo,
          booking_id: p.bookingId,
          payment_mode: p.paymentMode,
          amount: p.amount,
          failed_condition: p.failedCondition,
          raw_error: p.rawError ?? null,
          actor_full_name: full_name,
        },
      })
      .select("id, actor_id, actor_email, created_at")
      .single();

    if (error || !data) return null;
    return {
      id: data.id,
      actor_id: data.actor_id,
      actor_email: data.actor_email,
      actor_full_name: full_name,
      failed_condition: p.failedCondition,
      receipt_no: p.receiptNo,
      created_at: data.created_at,
    };
  } catch {
    return null;
  }
}


