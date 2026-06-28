import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtPKR } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { AlertTriangle, CalendarIcon, FileText, Plus, Search, X } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { PaymentForm, PAYMENT_TYPES } from "@/components/PaymentForm";
import { PaymentReceipt } from "@/components/PaymentReceipt";
import { buildReplayInitial } from "@/lib/paymentReplay";

export default function Payments() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const bookingFilter = params.get("booking") ?? "";
  const openReceiptParam = params.get("openReceipt");
  const auditIdParam = params.get("audit");

  const [search, setSearch] = useState("");
  const [type, setType] = useState("All");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [receiptNo, setReceiptNo] = useState<string | null>(null);
  const [replayInitial, setReplayInitial] = useState<
    (Partial<import("@/components/PaymentForm").PaymentFormValue> & { booking_id?: string }) | null
  >(null);
  const [replayAuditId, setReplayAuditId] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<{
    title: string;
    detail: string;
    receiptNo?: string | null;
    auditId?: string | null;
  } | null>(null);
  // Bumped by the Retry button. Used as an effect dependency so the
  // replay effect re-runs the latest audit fetch (same openReceipt +
  // audit params) without changing the URL.
  const [retryNonce, setRetryNonce] = useState(0);

  // Honor /payments?openReceipt=PAY-00012&audit=<id> from the audit log back link.
  // Fetch the audit row's `after` payload, prefill the form, and pop the dialog.
  //
  // The URL params are intentionally LEFT IN PLACE while the dialog is open so
  // a browser refresh re-runs this effect and prefills the form again with the
  // exact same receipt + attempt. The params are cleared only when the dialog
  // is dismissed (cancel / save / close) so re-opening Payments later doesn't
  // re-pop the dialog.
  useEffect(() => {
    if (!openReceiptParam) return;
    let cancelled = false;
    (async () => {
      setReplayError(null);
      let after: Record<string, any> | null = null;
      let auditMissing = false;
      let fetchFailed: string | null = null;

      if (auditIdParam) {
        const { data, error } = await supabase
          .from("audit_logs")
          .select("after, entity_id")
          .eq("id", auditIdParam)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          fetchFailed = error.message || "Audit lookup failed.";
        } else if (!data) {
          auditMissing = true;
        } else {
          after = (data.after ?? {}) as Record<string, any>;
          // Sanity-check that the audit row actually belongs to this receipt.
          if (data.entity_id && data.entity_id !== openReceiptParam) {
            setReplayError({
              title: "Audit entry doesn't match this receipt",
              detail: `Audit ${auditIdParam} was recorded against ${data.entity_id}, not ${openReceiptParam}. The URL may have been edited manually.`,
              receiptNo: openReceiptParam,
              auditId: auditIdParam,
            });
            return;
          }
        }
      }

      if (cancelled) return;

      if (fetchFailed) {
        setReplayError({
          title: "Couldn't load the blocked attempt",
          detail: `${fetchFailed} Try opening it again from the Audit Log.`,
          receiptNo: openReceiptParam,
          auditId: auditIdParam,
        });
        return;
      }

      if (auditMissing) {
        setReplayError({
          title: "Audit entry not found",
          detail: `No blocked-save record exists for audit id ${auditIdParam}. It may have been pruned, or the link is stale.`,
          receiptNo: openReceiptParam,
          auditId: auditIdParam,
        });
        return;
      }

      const initial = buildReplayInitial(openReceiptParam, after);
      if (!initial) {
        setReplayError({
          title: "Missing receipt in the URL",
          detail: "The back link did not include a receipt number, so the Payment form can't be prefilled.",
        });
        return;
      }
      // Final safeguard: if the component unmounted (or the URL params
      // changed) between the last `await` and here, do NOT mutate state
      // or auto-open the replay dialog. The cleanup below flips
      // `cancelled = true`, which gates every state setter in this branch.
      if (cancelled) return;
      setReplayInitial(initial);
      setReplayAuditId(auditIdParam ?? null);
      setCreateOpen(true);
    })();
    return () => {
      // Unmount / dep-change cancellation: any in-flight audit fetch
      // resolves to a no-op, so the replay banner + dialog can never
      // appear after the user has navigated away or dismissed the params.
      cancelled = true;
    };

  }, [openReceiptParam, auditIdParam, retryNonce]);


  const clearReplayParams = () => {
    const next = new URLSearchParams(params);
    next.delete("openReceipt");
    next.delete("audit");
    setParams(next, { replace: true });
  };


  const { data: rows = [] } = useQuery({
    queryKey: ["payments"],
    queryFn: async () =>
      (await supabase.from("payments").select("*").order("payment_date", { ascending: false })).data ?? [],
  });

  const filtered = useMemo(() => {
    const lq = search.trim().toLowerCase();
    return rows.filter((p: any) => {
      if (bookingFilter && p.booking_id !== bookingFilter) return false;
      if (type !== "All" && (p.payment_mode ?? "") !== type) return false;
      if (from && (p.payment_date ?? "") < from) return false;
      if (to && (p.payment_date ?? "") > to) return false;
      if (!lq) return true;
      return [p.receipt_no, p.booking_id, p.client_name, p.unit_no, p.cheque_txn_no]
        .some((v) => String(v ?? "").toLowerCase().includes(lq));
    });
  }, [rows, search, type, from, to, bookingFilter]);

  const totals = useMemo(() => {
    let cash = 0, bank = 0, adj = 0;
    for (const p of filtered as any[]) {
      const amt = Number(p.amount || 0);
      if (p.payment_mode === "Cash") cash += amt;
      else if (p.payment_mode === "Bank Transfer") bank += amt;
      else if (p.payment_mode === "Adjustment/Asset" || p.payment_mode === "Adjustment") adj += amt;
    }
    return { cash, bank, adj, grand: cash + bank + adj };
  }, [filtered]);

  const DateBtn = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("h-9 justify-start text-left font-normal min-w-[140px]", !value && "text-muted-foreground")}>
          <CalendarIcon className="h-4 w-4 mr-2" />
          {value ? format(new Date(value), "dd-MMM-yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? new Date(value) : undefined}
          onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );

  const typeBadgeTone = (m: string) =>
    m === "Cash" ? "success" : m === "Bank Transfer" ? "info" : "adjustment";

  // Route guard: when the URL contains a deep-link (openReceipt + optional audit),
  // PaymentForm must stay inaccessible until the latest audit prefill fetch
  // succeeds (i.e. replayInitial is populated). This blocks BOTH the "Record
  // payment" button AND the Dialog open prop, so neither direct navigation nor
  // a user click can mount the form with stale/empty prefill while a deep-link
  // is pending or has failed.
  const deepLinkGuardActive = !!openReceiptParam && !replayInitial;

  return (
    <div>
      <PageHeader
        title="Payments"
        description={`${rows.length} receipts · Cash & Bank kept separate from Adjustment/Asset`}
        actions={
          <Button
            onClick={() => { if (!deepLinkGuardActive) setCreateOpen(true); }}
            disabled={deepLinkGuardActive}
            aria-disabled={deepLinkGuardActive}
            title={deepLinkGuardActive ? "Waiting for the linked audit attempt to load…" : undefined}
          >
            <Plus className="h-4 w-4" /> Record payment
          </Button>
        }
      />


      {replayError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-destructive">{replayError.title}</div>
            <div className="mt-1 text-foreground/80">{replayError.detail}</div>
            {(replayError.receiptNo || replayError.auditId) && (
              <div className="mt-1 text-[11px] text-muted-foreground font-mono">
                {replayError.receiptNo && <>receipt: {replayError.receiptNo}</>}
                {replayError.receiptNo && replayError.auditId && <> · </>}
                {replayError.auditId && <>audit: {replayError.auditId}</>}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
              {replayError.auditId && openReceiptParam && auditIdParam && (
                <button
                  type="button"
                  aria-label="Retry latest audit fetch"
                  onClick={() => { setReplayError(null); setRetryNonce((n) => n + 1); }}
                  className="font-semibold text-primary hover:underline"
                >
                  Retry
                </button>
              )}
              {replayError.auditId && (
                <Link
                  to={`/audit?highlight=${encodeURIComponent(replayError.auditId)}`}
                  className="font-semibold text-primary hover:underline"
                >
                  Open Audit Log
                </Link>
              )}
              <button
                type="button"
                onClick={() => { setReplayError(null); clearReplayParams(); }}
                className="font-semibold text-muted-foreground hover:text-foreground"
              >
                Start a fresh payment instead
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => { setReplayError(null); clearReplayParams(); }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}


      {/* Filter bar */}
      <div className="card-elevated p-3 mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Receipt, Booking ID, Client, Unit…"
            className="pl-9 bg-muted/40 border-transparent h-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All</SelectItem>
              {PAYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">From</Label>
          <DateBtn value={from} onChange={setFrom} placeholder="From date" />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">To</Label>
          <DateBtn value={to} onChange={setTo} placeholder="To date" />
        </div>
        {(from || to || type !== "All" || search || bookingFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setType("All"); setFrom(""); setTo(""); }}>
            Clear
          </Button>
        )}
        <div className="text-xs text-muted-foreground tabular-nums ml-auto">{filtered.length} of {rows.length}</div>
      </div>

      {/* Table */}
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm table-sticky">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 border-b">ID</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Date</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Client</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Unit</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Type</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Head</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Amount (PKR)</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Reference</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-muted-foreground p-10">No payments match these filters.</td></tr>
              ) : filtered.map((p: any) => (
                <tr key={p.receipt_no} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-mono text-xs text-primary">{p.receipt_no}</td>
                  <td className="px-4 py-2.5">{fmtDate(p.payment_date)}</td>
                  <td className="px-4 py-2.5 capitalize">{p.client_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{p.unit_no}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge label={p.payment_mode ?? "—"} tone={typeBadgeTone(p.payment_mode) as any} />
                  </td>
                  <td className="px-4 py-2.5 text-xs">{p.payment_head ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtPKR(p.amount)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.cheque_txn_no ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setReceiptNo(p.receipt_no)}>
                      <FileText className="h-3.5 w-3.5 mr-1" /> View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Summary footer — Cash / Bank / Adjustment shown SEPARATELY */}
            <tfoot className="bg-muted/40 text-sm font-semibold border-t-2 border-primary/30">
              <tr>
                <td colSpan={6} className="px-4 py-3 text-right text-xs uppercase tracking-wide text-muted-foreground">
                  Totals (filtered)
                </td>
                <td className="px-4 py-3 text-right tabular-nums" colSpan={3}>
                  <div className="grid grid-cols-4 gap-4 text-xs">
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Cash</div>
                      <div className="text-success">{fmtPKR(totals.cash)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Bank</div>
                      <div className="text-info">{fmtPKR(totals.bank)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Adjustment</div>
                      <div className="text-adjustment">{fmtPKR(totals.adj)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Grand</div>
                      <div className="text-primary">{fmtPKR(totals.grand)}</div>
                    </div>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <Dialog
        open={createOpen && !deepLinkGuardActive}
        onOpenChange={(o) => {
          if (o && deepLinkGuardActive) return; // hard guard: cannot open while latest prefill is pending/failed
          setCreateOpen(o);
          if (!o) { setReplayInitial(null); setReplayAuditId(null); clearReplayParams(); }
        }}
      >

        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{replayInitial ? "Replay blocked payment" : "Record payment"}</DialogTitle>
            <DialogDescription>
              {replayInitial
                ? `Re-attempting ${replayInitial.receipt_no} from the audit log. Inspect the prior failure in the drawer, adjust, and save.`
                : "Cash and Bank Transfer count toward Cash Received. Adjustment/Asset is tracked separately."}
            </DialogDescription>
          </DialogHeader>
          <PaymentForm
            key={replayAuditId ?? "new"}
            initial={replayInitial ?? (bookingFilter ? { booking_id: bookingFilter } : undefined)}
            replayBlocked={!!replayInitial}
            prefillAuditId={replayAuditId}
            onCancel={() => { setCreateOpen(false); setReplayInitial(null); setReplayAuditId(null); clearReplayParams(); }}
            onSaved={(no) => {
              setCreateOpen(false);
              setReplayInitial(null);
              setReplayAuditId(null);
              clearReplayParams();
              qc.invalidateQueries({ queryKey: ["payments"] });
              setReceiptNo(no);
            }}
          />
        </DialogContent>
      </Dialog>



      <PaymentReceipt open={!!receiptNo} onOpenChange={(o) => !o && setReceiptNo(null)} receiptNo={receiptNo} />
    </div>
  );
}
