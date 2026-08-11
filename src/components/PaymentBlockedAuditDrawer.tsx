import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, Loader2, ShieldAlert, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { fmtPKR } from "@/lib/format";
import type { PaymentBlockedAuditEntry } from "@/lib/audit";
import { suggestPaymentFix, type FailedCondition, type PaymentFixSuggestion } from "@/lib/paymentErrors";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audit: PaymentBlockedAuditEntry | null;
  /** The payload the user attempted to save when the block happened. */
  attempted: Record<string, unknown> | null;
  /** Apply the suggested fix to the live Payment form and re-run validation. */
  onApplyFix?: (suggestion: PaymentFixSuggestion) => void;
}

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string;
  actor_id: string;
  actor_email: string | null;
  created_at: string;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
}

const DIFF_FIELDS: { key: string; label: string; kind?: "money" | "bool" | "text" }[] = [
  { key: "payment_mode", label: "Payment Type" },
  { key: "amount", label: "Amount", kind: "money" },
  { key: "safe_cash_amount", label: "Safe cash amount", kind: "money" },
  { key: "non_cash_adjustment", label: "Non-cash adjustment flag", kind: "bool" },
  { key: "cash_bank_include", label: "Counts toward Cash/Bank", kind: "bool" },
  { key: "payment_head", label: "Payment Head" },
  { key: "payment_date", label: "Payment Date" },
  { key: "account", label: "Account" },
  { key: "booking_id", label: "Booking" },
];

function fmt(v: any, kind?: "money" | "bool" | "text"): string {
  if (v === null || v === undefined || v === "") return "—";
  if (kind === "money") return fmtPKR(Number(v) || 0);
  if (kind === "bool") return v ? "true" : "false";
  return String(v);
}

function eq(a: any, b: any): boolean {
  if (a === null || a === undefined) a = "";
  if (b === null || b === undefined) b = "";
  if (typeof a === "number" || typeof b === "number") {
    return Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
  }
  return String(a) === String(b);
}

export function PaymentBlockedAuditDrawer({ open, onOpenChange, audit, attempted, onApplyFix }: Props) {
  const [loading, setLoading] = useState(false);
  const [auditRow, setAuditRow] = useState<AuditRow | null>(null);
  const [currentDb, setCurrentDb] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    if (!open || !audit) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [aRes, pRes] = await Promise.all([
          supabase
            .from("audit_logs")
            .select("id, action, entity, entity_id, actor_id, actor_email, created_at, before, after")
            .eq("id", audit.id)
            .maybeSingle(),
          supabase
            .from("payments")
            .select("*")
            .eq("receipt_no", audit.receipt_no)
            .maybeSingle(),
        ]);
        if (!cancelled) {
          setAuditRow((aRes.data as AuditRow | null) ?? null);
          setCurrentDb((pRes.data as Record<string, any> | null) ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, audit]);

  const attemptedPayload =
    attempted ?? (auditRow?.after as Record<string, any> | null) ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            Blocked save · audit entry
          </SheetTitle>
          <SheetDescription>
            Full audit-log record and a field-by-field diff between the values you
            attempted to save and what is currently in the database.
          </SheetDescription>
        </SheetHeader>

        {!audit ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No blocked attempt in this session.
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {/* Audit metadata */}
            <section className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
                <div className="text-muted-foreground">Audit ID</div>
                <div className="font-mono text-[11px] break-all">{audit.id}</div>
                <div className="text-muted-foreground">Action</div>
                <div>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {auditRow?.action ?? "payment.save.blocked"}
                  </Badge>
                </div>
                <div className="text-muted-foreground">Entity</div>
                <div className="font-mono">
                  {auditRow?.entity ?? "payment"} · {auditRow?.entity_id ?? audit.receipt_no}
                </div>
                <div className="text-muted-foreground">Actor</div>
                <div>
                  {audit.actor_full_name || audit.actor_email || audit.actor_id}
                  {audit.actor_full_name && audit.actor_email && (
                    <span className="text-muted-foreground"> · {audit.actor_email}</span>
                  )}
                </div>
                <div className="text-muted-foreground">When</div>
                <div className="tabular-nums">
                  {new Date(audit.created_at).toLocaleString("en-PK")}
                </div>
                <div className="text-muted-foreground">Failed condition</div>
                <div>
                  <code className="rounded bg-destructive/10 px-1 py-0.5 font-mono text-[10px] text-destructive">
                    {audit.failed_condition}
                  </code>
                </div>
                {auditRow?.after?.raw_error && (
                  <>
                    <div className="text-muted-foreground">Raw error</div>
                    <div className="font-mono text-[10px] text-destructive whitespace-pre-wrap break-words">
                      {String(auditRow.after.raw_error)}
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* Field-by-field diff */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Field-by-field diff</h3>
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Field</th>
                      <th className="text-left px-2 py-1.5 font-medium">Currently in DB</th>
                      <th className="text-left px-2 py-1.5 font-medium">You attempted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIFF_FIELDS.map((f) => {
                      const cur = currentDb?.[f.key];
                      const att = attemptedPayload?.[f.key];
                      const same = eq(cur, att);
                      return (
                        <tr
                          key={f.key}
                          className={cn(
                            "border-t",
                            !same && "bg-destructive/5"
                          )}
                        >
                          <td className="px-2 py-1.5 text-muted-foreground">{f.label}</td>
                          <td className="px-2 py-1.5 font-mono">
                            {currentDb ? (
                              fmt(cur, f.kind)
                            ) : (
                              <span className="italic text-muted-foreground">
                                {loading ? "…" : "no existing row"}
                              </span>
                            )}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1.5 font-mono",
                              !same && "text-destructive font-semibold"
                            )}
                          >
                            {fmt(att, f.kind)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!currentDb && !loading && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  No payment row exists in the database for{" "}
                  <span className="font-mono">{audit.receipt_no}</span> — this
                  was a new-record attempt, so every attempted value is a delta
                  from "nothing on file".
                </p>
              )}
            </section>

            {/* Raw payload */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Attempted payload (raw)</h3>
              <pre className="rounded-md border bg-muted/30 p-2 text-[10px] font-mono whitespace-pre-wrap break-words max-h-64 overflow-auto">
{JSON.stringify(attemptedPayload ?? {}, null, 2)}
              </pre>
            </section>

            {/* Suggested fix */}
            {(() => {
              const suggestion = suggestPaymentFix(
                (audit.failed_condition as FailedCondition) || "unknown",
                attemptedPayload,
                currentDb,
              );
              if (!suggestion) {
                return (
                  <section className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                    No automatic fix is available for this condition — review the
                    diff above and adjust the form manually.
                  </section>
                );
              }
              const patchEntries = Object.entries(suggestion.patch);
              return (
                <section className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <Wand2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                          Suggested fix
                        </div>
                        <p className="mt-0.5 text-foreground">{suggestion.summary}</p>
                      </div>
                      {(patchEntries.length > 0 || suggestion.nextReceipt) && (
                        <div className="rounded border bg-background/60 p-2">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                            Changes to apply
                          </div>
                          <ul className="space-y-0.5 font-mono text-[11px]">
                            {suggestion.nextReceipt && (
                              <li>
                                <span className="text-muted-foreground">receipt_no</span>{" "}
                                → <span className="text-primary">next free PAY-…</span>
                              </li>
                            )}
                            {patchEntries.map(([k, v]) => (
                              <li key={k}>
                                <span className="text-muted-foreground">{k}</span>{" "}
                                → <span className="text-primary">{String(v)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!onApplyFix}
                        onClick={() => {
                          if (!onApplyFix) return;
                          onApplyFix(suggestion);
                          onOpenChange(false);
                        }}
                        title={
                          onApplyFix
                            ? "Apply the patch to the form and re-run validation"
                            : "Open this drawer from the Payment form to apply fixes"
                        }
                      >
                        <Wand2 className="h-3.5 w-3.5 mr-1" />
                        Use suggested fix
                      </Button>
                    </div>
                  </div>
                </section>
              );
            })()}

            <div className="flex items-center justify-between gap-2 pt-2 border-t">
              <Button asChild variant="outline" size="sm">
                <Link to={`/audit?highlight=${audit.id}`} target="_blank" rel="noopener noreferrer">
                  Open in Audit Log <ExternalLink className="h-3 w-3 ml-1" />
                </Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
