import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Loader2, Check, ChevronsUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { fmtPKR } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { logPaymentBlocked, type PaymentBlockedAuditEntry } from "@/lib/audit";
import { mapPaymentError } from "@/lib/paymentErrors";
import { Link } from "react-router-dom";
import { ShieldAlert, ExternalLink, FileSearch, History, ChevronDown } from "lucide-react";
import { PaymentBlockedAuditDrawer } from "@/components/PaymentBlockedAuditDrawer";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const PAYMENT_TYPES = ["Cash", "Bank Transfer", "Adjustment/Asset"] as const;
export const PAYMENT_HEADS = ["Down Payment", "Installment", "Possession", "Advance", "Extra Payment"] as const;

const schema = z.object({
  receipt_no: z.string().regex(/^PAY-\d{5}$/),
  booking_id: z.string().min(1, "Booking is required"),
  payment_date: z.string().min(1, "Date is required"),
  payment_mode: z.enum(PAYMENT_TYPES),
  amount: z.number().positive("Amount must be greater than 0"),
  payment_head: z.enum(PAYMENT_HEADS),
  account: z.string().trim().max(120).optional().or(z.literal("")),
  cheque_txn_no: z.string().trim().max(60).optional().or(z.literal("")),
  posted_by: z.string().trim().max(120).optional().or(z.literal("")),
  remarks: z.string().trim().max(500).optional().or(z.literal("")),
});

export type PaymentFormValue = z.infer<typeof schema>;

async function nextPaymentId() {
  const { data } = await supabase
    .from("payments")
    .select("receipt_no")
    .like("receipt_no", "PAY-%");
  const maxN = (data ?? []).reduce((m, r) => {
    const n = Number(String(r.receipt_no).replace("PAY-", ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `PAY-${String(maxN + 1).padStart(5, "0")}`;
}

interface PaymentFormProps {
  initial?: Partial<PaymentFormValue> & { booking_id?: string };
  onSaved: (receiptNo: string) => void;
  onCancel: () => void;
}

export function PaymentForm({ initial, onSaved, onCancel }: PaymentFormProps) {
  const { toast } = useToast();
  const isEdit = Boolean(initial?.receipt_no);
  const [form, setForm] = useState<PaymentFormValue>({
    receipt_no: initial?.receipt_no ?? "",
    booking_id: initial?.booking_id ?? "",
    payment_date: initial?.payment_date ?? format(new Date(), "yyyy-MM-dd"),
    payment_mode: (initial?.payment_mode as any) ?? "Cash",
    amount: Number(initial?.amount ?? 0),
    payment_head: (initial?.payment_head as any) ?? "Installment",
    account: initial?.account ?? "",
    cheque_txn_no: initial?.cheque_txn_no ?? "",
    posted_by: initial?.posted_by ?? "",
    remarks: initial?.remarks ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [blockedAudit, setBlockedAudit] = useState<PaymentBlockedAuditEntry | null>(null);
  const [blockedPayload, setBlockedPayload] = useState<Record<string, any> | null>(null);
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
  const [viewingAudit, setViewingAudit] = useState<PaymentBlockedAuditEntry | null>(null);
  const paymentTypeRef = useRef<HTMLButtonElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const { data: bookings = [] } = useQuery({
    queryKey: ["bookings-min"],
    queryFn: async () =>
      (await supabase
        .from("bookings")
        .select("booking_id,client_name,unit_id,total_contract_value,remaining_balance,installment_amount")
        .order("client_name")).data ?? [],
  });

  // Booking-scoped ledger summary for the impact preview line.
  const { data: bookingImpact } = useQuery({
    queryKey: ["payment-booking-impact", form.booking_id, form.receipt_no],
    enabled: !!form.booking_id,
    queryFn: async () => {
      const [{ data: led }, { data: pays }] = await Promise.all([
        supabase
          .from("installment_ledger")
          .select("term_no,due_amount,paid_amount,status,due_date")
          .eq("booking_id", form.booking_id)
          .order("due_date", { ascending: true }),
        supabase
          .from("payments")
          .select("receipt_no,amount")
          .eq("booking_id", form.booking_id),
      ]);
      const ledger = led ?? [];
      const totalDue = ledger.reduce((s, r: any) => s + (Number(r.due_amount) || 0), 0);
      const totalPaid = ledger.reduce((s, r: any) => s + (Number(r.paid_amount) || 0), 0);
      const bookingPaid = (pays ?? []).reduce((s, r: any) => s + (Number(r.amount) || 0), 0);
      const prevAmt = (pays ?? []).find((p: any) => p.receipt_no === form.receipt_no)?.amount ?? 0;
      const nextDue = ledger.find((r: any) => (r.status || "").toLowerCase() !== "paid") ?? null;
      return { ledger, totalDue, totalPaid, bookingPaid, prevAmt: Number(prevAmt) || 0, nextDue };
    },
    staleTime: 5_000,
  });


  // Live totals — used to preview the Cash / Adjustment impact of this entry.
  const { data: totals } = useQuery({
    queryKey: ["payment-totals-preview", form.receipt_no],
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select("receipt_no,amount,safe_cash_amount,payment_mode,non_cash_adjustment");
      const rows = data ?? [];
      const cashTotal = rows.reduce((s: number, r: any) => s + (Number(r.safe_cash_amount) || 0), 0);
      const adjTotal = rows
        .filter((r: any) => r.payment_mode === "Adjustment/Asset" || r.non_cash_adjustment)
        .reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
      const prev = rows.find((r: any) => r.receipt_no === form.receipt_no) ?? null;
      return { cashTotal, adjTotal, prev };
    },
    staleTime: 5_000,
  });


  useEffect(() => {
    if (!isEdit && !form.receipt_no) {
      nextPaymentId().then((id) => setForm((f) => ({ ...f, receipt_no: id })));
    }
  }, [isEdit, form.receipt_no]);

  const selectedBooking = useMemo(
    () => bookings.find((b: any) => b.booking_id === form.booking_id),
    [bookings, form.booking_id]
  );

  // Fields whose value materially changes the cash-vs-adjustment outcome.
  // Toggling any of them should unlock the form after a trigger block — not
  // just Payment Type — because they're the same knobs the user has to turn
  // to satisfy the safe_cash_amount invariant.
  const UNLOCK_KEYS = new Set<keyof PaymentFormValue>([
    "payment_mode",
    "amount",
    "payment_head",
  ]);
  const set = <K extends keyof PaymentFormValue>(k: K, v: PaymentFormValue[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k as string]: "" }));
    // Unlock when the user toggles any adjustment / non-cash option that
    // could resolve the block (Payment Type, Amount, or Payment Head).
    if (blockedAudit && UNLOCK_KEYS.has(k)) {
      setBlockedAudit(null);
      setBlockedPayload(null);
    }
  };

  // Form is locked after a Postgres trigger block until Payment Type changes.
  const locked = !!blockedAudit;

  // Pre-flight check: would the impact preview violate the safe_cash_amount invariant?
  // For Adjustment/Asset we force safe_cash_amount = 0, so the only way to violate
  // is editing a row whose previous safe_cash_amount was non-zero (cash→adjustment
  // conversion). That exactly matches what the Postgres trigger will block.
  const invariantWouldFail = useMemo(() => {
    if (form.payment_mode !== "Adjustment/Asset") return false;
    const prev = (totals as any)?.prev;
    if (!prev) return false;
    return Math.abs(Number(prev.safe_cash_amount) || 0) > 0.005;
  }, [form.payment_mode, totals]);

  const handleSave = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { errs[i.path.join(".")] = i.message; });
      setErrors(errs);
      toast({ variant: "destructive", title: "Please fix the highlighted fields" });
      return;
    }
    setSaving(true);

    // CRITICAL: enforce cash-vs-adjustment separation
    const isAdjustment = form.payment_mode === "Adjustment/Asset";
    const safe_cash_amount = isAdjustment ? 0 : form.amount;

    // HARD GUARD — when saving an Adjustment/Asset payment, Cash Received must
    // not move. Pre-snapshot the global SUM(safe_cash_amount); save; re-snapshot;
    // if it changed by even 1 paisa, roll back and block.
    let cashBefore = 0;
    let ledgerPaidBefore = 0;
    let bookingCashBefore = 0;
    if (isAdjustment) {
      // Block illegal type conversions on edit (cash↔adjustment would shift totals)
      if (isEdit) {
        const { data: orig } = await supabase
          .from("payments")
          .select("payment_mode")
          .eq("receipt_no", form.receipt_no)
          .maybeSingle();
        if (orig && orig.payment_mode !== "Adjustment/Asset") {
          setSaving(false);
          toast({
            variant: "destructive",
            title: "Type change blocked",
            description: "A Cash / Bank Transfer payment cannot be converted to Adjustment/Asset — it would alter Cash Received totals.",
          });
          return;
        }
      }
      const [{ data: snap }, { data: ledSnap }, { data: bkSnap }] = await Promise.all([
        supabase.from("payments").select("safe_cash_amount"),
        supabase.from("installment_ledger").select("paid_amount").eq("booking_id", form.booking_id),
        supabase.from("payments").select("safe_cash_amount").eq("booking_id", form.booking_id),
      ]);
      cashBefore = (snap ?? []).reduce((s: number, r: any) => s + (Number(r.safe_cash_amount) || 0), 0);
      ledgerPaidBefore = (ledSnap ?? []).reduce((s: number, r: any) => s + (Number(r.paid_amount) || 0), 0);
      bookingCashBefore = (bkSnap ?? []).reduce((s: number, r: any) => s + (Number(r.safe_cash_amount) || 0), 0);
    }

    const payload: any = {
      receipt_no: form.receipt_no,
      booking_id: form.booking_id,
      client_name: selectedBooking?.client_name ?? null,
      unit_no: selectedBooking?.unit_id ?? null,
      project: "Manal Arcade",
      payment_date: form.payment_date,
      payment_mode: form.payment_mode,
      payment_head: form.payment_head,
      amount: form.amount,
      safe_cash_amount,
      cash_bank_include: !isAdjustment,
      non_cash_adjustment: isAdjustment,
      account: form.payment_mode === "Bank Transfer" ? (form.account || null) : null,
      cheque_txn_no: form.cheque_txn_no || null,
      posted_by: form.posted_by || null,
      remarks: form.remarks || null,
      status: "Posted",
    };

    const { error } = isEdit
      ? await supabase.from("payments").update(payload).eq("receipt_no", form.receipt_no)
      : await supabase.from("payments").insert(payload);

    if (error) {
      setSaving(false);
      const raw = error.message || "";
      const mapped = mapPaymentError(error as any, { paymentMode: form.payment_mode });

      if (mapped.isCashInvariant) {
        setErrors((e) => ({ ...e, ...mapped.fieldErrors }));

        const auditEntry = await logPaymentBlocked({
          receiptNo: form.receipt_no,
          bookingId: form.booking_id,
          paymentMode: form.payment_mode,
          amount: form.amount,
          failedCondition: mapped.failedCondition,
          rawError: raw,
        });
        setBlockedAudit(auditEntry);
        setBlockedPayload(payload);

        toast({
          variant: "destructive",
          title: mapped.toastTitle,
          description: mapped.toastDescription,
        });
        // Focus Payment Type and briefly scroll/flash the Amount field
        setTimeout(() => {
          paymentTypeRef.current?.focus();
          paymentTypeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          amountRef.current?.classList.add("ring-2", "ring-destructive");
          setTimeout(() => amountRef.current?.classList.remove("ring-2", "ring-destructive"), 1800);
        }, 50);
        return;
      }

      if (Object.keys(mapped.fieldErrors).length) {
        setErrors((e) => ({ ...e, ...mapped.fieldErrors }));
      }
      toast({
        variant: "destructive",
        title: mapped.toastTitle,
        description: mapped.toastDescription,
      });
      return;
    }


    // Post-write reconciliation for adjustment rows — re-read global cash,
    // booking-scoped cash, and ledger paid totals; rollback if ANY shifted.
    if (isAdjustment) {
      const [{ data: snap2 }, { data: ledSnap2 }, { data: bkSnap2 }] = await Promise.all([
        supabase.from("payments").select("safe_cash_amount"),
        supabase.from("installment_ledger").select("paid_amount").eq("booking_id", form.booking_id),
        supabase.from("payments").select("safe_cash_amount").eq("booking_id", form.booking_id),
      ]);
      const cashAfter = (snap2 ?? []).reduce((s: number, r: any) => s + (Number(r.safe_cash_amount) || 0), 0);
      const ledgerPaidAfter = (ledSnap2 ?? []).reduce((s: number, r: any) => s + (Number(r.paid_amount) || 0), 0);
      const bookingCashAfter = (bkSnap2 ?? []).reduce((s: number, r: any) => s + (Number(r.safe_cash_amount) || 0), 0);

      const dCash = cashAfter - cashBefore;
      const dBookingCash = bookingCashAfter - bookingCashBefore;
      const dLedger = ledgerPaidAfter - ledgerPaidBefore;
      const drift = Math.max(Math.abs(dCash), Math.abs(dBookingCash), Math.abs(dLedger));

      if (drift > 0.5) {
        // Roll back the just-inserted row (edits cannot be auto-reverted).
        if (!isEdit) {
          await supabase.from("payments").delete().eq("receipt_no", form.receipt_no);
        }
        setSaving(false);
        const parts: string[] = [];
        if (Math.abs(dCash) > 0.5) parts.push(`global cash Δ ${dCash.toLocaleString("en-PK")}`);
        if (Math.abs(dBookingCash) > 0.5) parts.push(`booking cash Δ ${dBookingCash.toLocaleString("en-PK")}`);
        if (Math.abs(dLedger) > 0.5) parts.push(`ledger paid Δ ${dLedger.toLocaleString("en-PK")}`);
        toast({
          variant: "destructive",
          title: "Reconciliation failed — change reverted",
          description: `Adjustment/Asset must not move cash or ledger totals (${parts.join(", ")} PKR). ${isEdit ? "Please undo manually." : "The new row was deleted."}`,
        });
        return;
      }

      // Reconciliation passed — surface a confirmation in the toast.
      toast({
        title: isEdit ? "Adjustment updated — reconciled" : "Adjustment recorded — reconciled",
        description: `Cash totals unchanged (global, booking, ledger). Receipt ${form.receipt_no}.`,
      });
      setSaving(false);
      onSaved(form.receipt_no);
      return;
    }

    setSaving(false);
    toast({ title: isEdit ? "Payment updated" : "Payment recorded", description: form.receipt_no });
    onSaved(form.receipt_no);
  };


  const Err = ({ k }: { k: string }) =>
    errors[k] ? <p className="text-[11px] text-destructive mt-1">{errors[k]}</p> : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label>Payment ID</Label>
          <Input value={form.receipt_no} readOnly className="bg-muted/60 font-mono" />
        </div>
        <div>
          <Label>Payment Date *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" disabled={locked} className={cn("w-full justify-start text-left font-normal h-9", !form.payment_date && "text-muted-foreground")}>
                <CalendarIcon className="h-4 w-4 mr-2" />
                {form.payment_date ? format(new Date(form.payment_date), "dd-MMM-yyyy") : "Pick date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={form.payment_date ? new Date(form.payment_date) : undefined}
                onSelect={(d) => set("payment_date", d ? format(d, "yyyy-MM-dd") : "")}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Err k="payment_date" />
        </div>
        <div>
          <Label>Booking *</Label>
          <Popover open={bookingOpen} onOpenChange={setBookingOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" disabled={locked} className="w-full justify-between h-9 font-normal">
                <span className="truncate">
                  {selectedBooking
                    ? `${selectedBooking.client_name} · ${selectedBooking.booking_id} · ${selectedBooking.unit_id}`
                    : "Select booking…"}
                </span>
                <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[420px] pointer-events-auto" align="start">
              <Command>
                <CommandInput placeholder="Search by client, booking, unit…" />
                <CommandList>
                  <CommandEmpty>No bookings found.</CommandEmpty>
                  <CommandGroup>
                    {bookings.map((b: any) => (
                      <CommandItem
                        key={b.booking_id}
                        value={`${b.client_name} ${b.booking_id} ${b.unit_id}`}
                        onSelect={() => { set("booking_id", b.booking_id); setBookingOpen(false); }}
                      >
                        <Check className={cn("h-4 w-4 mr-2", form.booking_id === b.booking_id ? "opacity-100" : "opacity-0")} />
                        <span className="capitalize flex-1 truncate">{b.client_name}</span>
                        <span className="font-mono text-xs text-muted-foreground ml-2">{b.booking_id}</span>
                        <span className="font-mono text-xs text-muted-foreground ml-2">{b.unit_id}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Err k="booking_id" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label>Payment Type *</Label>
          <Select value={form.payment_mode} onValueChange={(v) => set("payment_mode", v as any)}>
            <SelectTrigger
              ref={paymentTypeRef}
              className={cn(errors.payment_mode && "border-destructive ring-2 ring-destructive/40 focus:ring-destructive")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{PAYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          {errors.payment_mode ? (
            <div className="mt-1 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive leading-snug">
              <span className="font-semibold">Cash Received protected.</span> {errors.payment_mode}
            </div>
          ) : form.payment_mode === "Adjustment/Asset" ? (
            <p className="text-[11px] text-adjustment mt-1">
              Adjustment/Asset entries are excluded from Cash Received totals.
            </p>
          ) : null}
          {blockedAudit && (() => {
            const help: Record<string, { summary: string; fix: string }> = {
              adjustment_safe_cash_not_zero: {
                summary: "An Adjustment/Asset entry tried to keep a non-zero cash amount, which would inflate Cash Received.",
                fix: "Switch Payment Type to Cash or Bank Transfer if money was actually received, or keep it as Adjustment/Asset and let the system zero the cash side.",
              },
              type_conversion_blocked: {
                summary: "You are converting an existing Cash/Bank payment into Adjustment/Asset — Cash Received would drop retroactively.",
                fix: "Change Payment Type back to its original value, or delete this payment and create a fresh Adjustment/Asset entry instead.",
              },
              adjustment_flag_missing: {
                summary: "The non-cash adjustment flag was not set on an Adjustment/Asset row.",
                fix: "Change Payment Type to Cash/Bank for real receipts, or re-select Adjustment/Asset so the flags are written correctly.",
              },
              cash_bank_include_inconsistent: {
                summary: "The row was marked as included in Cash/Bank totals but typed Adjustment/Asset — those two cannot coexist.",
                fix: "Pick one Payment Type and re-save: Cash/Bank Transfer to count toward Cash Received, or Adjustment/Asset to exclude it.",
              },
              non_cash_flag_on_cash_row: {
                summary: "A Cash or Bank Transfer row was flagged as a non-cash adjustment.",
                fix: "Switch Payment Type to Adjustment/Asset if this is not a real receipt, otherwise re-select Cash/Bank Transfer.",
              },
              cash_amount_mismatch: {
                summary: "Amount and the internal cash-side amount disagree for a Cash/Bank row.",
                fix: "Re-enter the Amount — saving will rewrite the cash side to match.",
              },
              duplicate_receipt: {
                summary: "A payment with this receipt number already exists.",
                fix: "Open the existing payment to edit it, or generate a new receipt number.",
              },
              missing_reference: {
                summary: "The booking (or related record) referenced by this payment does not exist.",
                fix: "Re-select the Booking from the picker.",
              },
              missing_required_field: {
                summary: "A required field was empty when the database tried to save.",
                fix: "Fill in the highlighted field and try again.",
              },
              bad_value_format: {
                summary: "One of the values had an invalid format (number, date, or ID).",
                fix: "Check the Amount and Payment Date fields for typos.",
              },
              permission_denied: {
                summary: "Your role does not allow this change.",
                fix: "Ask an admin to make the change, or request the staff role.",
              },
              "cash_invariant.generic": {
                summary: "The database refused the save because it would change Cash Received totals.",
                fix: "Review Payment Type and Amount; for non-cash items use Adjustment/Asset.",
              },
              unknown: {
                summary: "The database refused the save with an unrecognized error.",
                fix: "Check the audit-log entry below for the raw message.",
              },
            };
            const info = help[blockedAudit.failed_condition] || help.unknown;
            return (
              <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] leading-snug">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="font-semibold text-destructive">Why it was blocked</span>
                  <code className="font-mono text-[10px] bg-destructive/10 text-destructive rounded px-1 py-0.5">
                    {blockedAudit.failed_condition}
                  </code>
                </div>
                <p className="text-foreground">{info.summary}</p>
                <p className="mt-1 text-muted-foreground">
                  <span className="font-semibold text-foreground">What to do: </span>
                  {info.fix}
                </p>
              </div>
            );
          })()}
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <Label>Amount (PKR) *</Label>
            {form.payment_mode === "Adjustment/Asset" && (() => {
              // The cash invariant rule sets safe_cash_amount = 0 for Adjustment/Asset
              // regardless of amount → the rule itself imposes NO upper bound on amount.
              // The practical cap is the booking's remaining balance.
              const remaining = Number((selectedBooking as any)?.remaining_balance);
              const fallback = bookingImpact
                ? Math.max(0, (Number((selectedBooking as any)?.total_contract_value) || 0) - bookingImpact.totalPaid)
                : null;
              const cap = Number.isFinite(remaining) ? remaining : fallback;
              return (
                <button
                  type="button"
                  onClick={() => cap != null && set("amount", Math.round(cap))}
                  className="text-[10px] text-adjustment hover:underline tabular-nums"
                  title="Cash rule imposes no cap (safe_cash_amount is forced to 0). Click to use remaining balance."
                >
                  Max safe: {cap != null ? fmtPKR(cap) : "unlimited"} ↑
                </button>
              );
            })()}
          </div>
          <Input
            ref={amountRef}
            type="number"
            min={0}
            value={form.amount || ""}
            onChange={(e) => set("amount", Number(e.target.value || 0))}
            className={cn(errors.amount && "border-destructive ring-2 ring-destructive/40 bg-destructive/5 animate-pulse")}
          />
          {form.payment_mode === "Adjustment/Asset" && (
            <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
              The <code className="font-mono">safe_cash_amount</code> rule does not cap Adjustment/Asset
              amounts (cash side is forced to 0). The cap shown is the booking's remaining balance.
            </p>
          )}
          <Err k="amount" />
        </div>
        <div>
          <Label>Payment Head *</Label>
          <Select value={form.payment_head} onValueChange={(v) => set("payment_head", v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_HEADS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Booking & installment impact preview line */}
      {selectedBooking && bookingImpact && (() => {
        const amt = Number(form.amount) || 0;
        const contract = Number((selectedBooking as any).total_contract_value) || 0;
        const remainingNow = Number((selectedBooking as any).remaining_balance);
        const remainingBase = Number.isFinite(remainingNow)
          ? remainingNow
          : Math.max(0, contract - bookingImpact.totalPaid);
        const netDelta = amt - bookingImpact.prevAmt;
        const projectedRemaining = Math.max(0, remainingBase - netDelta);
        const nextDue = bookingImpact.nextDue as any;
        const installmentAmt = Number((selectedBooking as any).installment_amount) || 0;
        return (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <div className="font-semibold text-foreground">
                {selectedBooking.client_name}
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {selectedBooking.booking_id} · Unit {selectedBooking.unit_id}
                </span>
              </div>
              <div className="text-muted-foreground">
                Contract <span className="font-semibold text-foreground tabular-nums">{fmtPKR(contract)}</span>
                <span className="mx-2">·</span>
                Paid <span className="font-semibold text-foreground tabular-nums">{fmtPKR(bookingImpact.totalPaid)}</span>
                <span className="mx-2">·</span>
                Remaining <span className="font-semibold text-foreground tabular-nums">{fmtPKR(remainingBase)}</span>
              </div>
            </div>
            {nextDue && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Next installment: term {nextDue.term_no} · due {nextDue.due_date}
                {installmentAmt > 0 && <> · <span className="tabular-nums">{fmtPKR(installmentAmt)}</span></>}
                {Number(nextDue.paid_amount) > 0 && (
                  <> · paid <span className="tabular-nums">{fmtPKR(Number(nextDue.paid_amount))}</span></>
                )}
              </div>
            )}
            {amt > 0 && (
              <div className="mt-2 pt-2 border-t border-border/60 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <div>
                  <span className="text-muted-foreground">After this save: </span>
                  <span className="font-semibold tabular-nums">
                    Paid {fmtPKR(bookingImpact.totalPaid + netDelta)}
                  </span>
                  <span className="mx-2 text-muted-foreground">→</span>
                  <span className={cn(
                    "font-semibold tabular-nums",
                    projectedRemaining === 0 ? "text-success" : "text-foreground"
                  )}>
                    Remaining {fmtPKR(projectedRemaining)}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Δ remaining <span className={cn(
                    "font-semibold tabular-nums",
                    netDelta > 0 ? "text-success" : netDelta < 0 ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {netDelta === 0 ? "PKR 0" : `${netDelta > 0 ? "−" : "+"} ${fmtPKR(Math.abs(netDelta))}`}
                  </span>
                  {isEdit && bookingImpact.prevAmt !== 0 && (
                    <span className="ml-1">(net of previous {fmtPKR(bookingImpact.prevAmt)})</span>
                  )}
                </div>
                {netDelta > remainingBase + 0.5 && (
                  <span className="text-[11px] font-semibold text-destructive">
                    ⚠ Exceeds remaining balance by {fmtPKR(netDelta - remainingBase)}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Audit log surfacing — appears when a save was rejected */}
      {blockedAudit && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-destructive">
                Save rejected — recorded to Audit Log
              </div>
              <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Actor: </span>
                  <span className="font-medium">
                    {blockedAudit.actor_full_name || blockedAudit.actor_email || blockedAudit.actor_id}
                  </span>
                  {blockedAudit.actor_full_name && blockedAudit.actor_email && (
                    <span className="text-muted-foreground"> ({blockedAudit.actor_email})</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">When: </span>
                  <span className="font-medium tabular-nums">
                    {new Date(blockedAudit.created_at).toLocaleString("en-PK")}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Failed condition: </span>
                  <code className="rounded bg-destructive/10 px-1 py-0.5 font-mono text-[10px] text-destructive">
                    {blockedAudit.failed_condition}
                  </code>
                </div>
                <div>
                  <span className="text-muted-foreground">Receipt: </span>
                  <span className="font-mono">{blockedAudit.receipt_no}</span>
                </div>
                <div className="md:col-span-2">
                  <span className="text-muted-foreground">Audit ID: </span>
                  <span className="font-mono text-[10px]">{blockedAudit.id}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Link
                  to={`/audit?highlight=${blockedAudit.id}`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive hover:underline"
                >
                  Open in Audit Log <ExternalLink className="h-3 w-3" />
                </Link>
                <button
                  type="button"
                  onClick={() => setAuditDrawerOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive hover:underline"
                >
                  <FileSearch className="h-3 w-3" />
                  View full audit + field-by-field diff
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                🔒 Form locked. Toggle any adjustment / non-cash option to unlock — change <span className="font-semibold text-foreground">Payment Type</span>, <span className="font-semibold text-foreground">Amount</span>, or <span className="font-semibold text-foreground">Payment Head</span> above.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Cash / Adjustment impact diff */}
      {(() => {
        const isAdj = form.payment_mode === "Adjustment/Asset";
        const amt = Number(form.amount) || 0;
        const projectedSafeCash = isAdj ? 0 : amt;

        // Old contribution from the row being edited (if any).
        const prev = totals?.prev ?? null;
        const prevWasAdj =
          !!prev && (prev.payment_mode === "Adjustment/Asset" || prev.non_cash_adjustment);
        const prevCash = Number(prev?.safe_cash_amount ?? 0);
        const prevAdj = prevWasAdj ? Number(prev?.amount ?? 0) : 0;

        // Net deltas (subtract previous row contribution for edits).
        const cashDelta = projectedSafeCash - prevCash;
        const adjDelta = (isAdj ? amt : 0) - prevAdj;
        const safeCashDelta = projectedSafeCash - prevCash; // same as cashDelta but labeled separately

        const curCash = totals?.cashTotal ?? 0;
        const curAdj = totals?.adjTotal ?? 0;

        const fmtDelta = (n: number) => {
          if (Math.abs(n) < 0.005) return "PKR 0  (unchanged)";
          const sign = n > 0 ? "+" : "−";
          return `${sign} ${fmtPKR(Math.abs(n))}`;
        };
        const deltaTone = (n: number, neutralOnZero = true) => {
          if (Math.abs(n) < 0.005) return neutralOnZero ? "text-muted-foreground" : "text-success";
          return n > 0 ? "text-success" : "text-destructive";
        };

        const rows = [
          {
            key: "cash_total",
            label: "cash_total",
            sub: "Σ payments.safe_cash_amount",
            before: curCash,
            after: curCash + cashDelta,
            delta: cashDelta,
            mustBeZero: isAdj,
          },
          {
            key: "adjustment_total",
            label: "adjustment_total",
            sub: "Σ payments.amount where Adjustment/Asset",
            before: curAdj,
            after: curAdj + adjDelta,
            delta: adjDelta,
            mustBeZero: false,
            tone: "adjustment" as const,
          },
          {
            key: "projected_safe_cash_amount",
            label: "projected_safe_cash_amount",
            sub: "this entry only",
            before: prevCash,
            after: projectedSafeCash,
            delta: safeCashDelta,
            mustBeZero: isAdj,
          },
        ];

        return (
          <div className={cn(
            "rounded-md border p-3 text-xs",
            isAdj ? "border-adjustment/40 bg-adjustment/5" : "border-border bg-muted/30"
          )}>
            <div className="font-semibold text-foreground mb-2 flex items-center justify-between">
              <span>
                Impact diff
                {isEdit && <span className="ml-1 text-[10px] text-muted-foreground">(net of previous values)</span>}
                {isAdj && <span className="text-adjustment"> · Adjustment/Asset entry</span>}
              </span>
              {isAdj && (
                <span className="text-[10px] uppercase tracking-wide text-adjustment font-semibold">
                  cash_total must not change
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Total</th>
                    <th className="py-1 px-2 font-medium text-right">Before</th>
                    <th className="py-1 px-2 font-medium text-right">After</th>
                    <th className="py-1 pl-2 font-medium text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const violated = r.mustBeZero && Math.abs(r.delta) > 0.005;
                    return (
                      <tr key={r.key} className="border-t border-border/40">
                        <td className="py-1.5 pr-2">
                          <div className={cn("font-mono", r.tone === "adjustment" && "text-adjustment")}>
                            {r.label}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{r.sub}</div>
                        </td>
                        <td className="py-1.5 px-2 text-right">{fmtPKR(r.before)}</td>
                        <td className={cn(
                          "py-1.5 px-2 text-right font-semibold",
                          violated && "text-destructive"
                        )}>
                          {fmtPKR(r.after)}
                        </td>
                        <td className={cn(
                          "py-1.5 pl-2 text-right font-semibold",
                          violated ? "text-destructive" : deltaTone(r.delta)
                        )}>
                          {fmtDelta(r.delta)}
                          {violated && <span className="ml-1">⚠</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {isAdj && Math.abs(cashDelta) < 0.005 && Math.abs(safeCashDelta) < 0.005 && (
              <p className="text-[11px] text-success mt-2">
                ✓ cash_total and safe_cash_amount both unchanged — save is safe.
              </p>
            )}
            {isAdj && (Math.abs(cashDelta) > 0.005 || Math.abs(safeCashDelta) > 0.005) && (
              <p className="text-[11px] text-destructive mt-2">
                ✗ This Adjustment/Asset would move cash totals — the database will reject the save.
              </p>
            )}
          </div>
        );
      })()}




      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {form.payment_mode === "Bank Transfer" && (
          <div>
            <Label>Bank Name</Label>
            <Input value={form.account ?? ""} disabled={locked} onChange={(e) => set("account", e.target.value)} placeholder="e.g. Meezan Bank" />
          </div>
        )}
        <div>
          <Label>Cheque / Reference Number</Label>
          <Input value={form.cheque_txn_no ?? ""} disabled={locked} onChange={(e) => set("cheque_txn_no", e.target.value)} />
        </div>
        <div>
          <Label>Received By</Label>
          <Input value={form.posted_by ?? ""} disabled={locked} onChange={(e) => set("posted_by", e.target.value)} />
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea rows={2} value={form.remarks ?? ""} disabled={locked} onChange={(e) => set("remarks", e.target.value)} />
      </div>

      <div className="flex flex-col gap-2 pt-2 border-t sm:flex-row sm:items-center sm:justify-between">
        <Link
          to={
            blockedAudit
              ? `/audit?highlight=${blockedAudit.id}`
              : `/audit?entity=payment&entity_id=${encodeURIComponent(form.receipt_no)}&action=payment.save.blocked`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          title={
            blockedAudit
              ? "Open the audit entry for the most recent blocked save"
              : "Open the audit log filtered to blocked-save attempts for this receipt"
          }
        >
          <ShieldAlert className="h-3 w-3" />
          View audit log
          {blockedAudit && <span className="text-destructive font-semibold">· 1 blocked</span>}
          <ExternalLink className="h-3 w-3" />
        </Link>
        <div className="flex flex-col items-end gap-1">
          {invariantWouldFail && (
            <p className="text-[11px] text-destructive font-medium">
              ✗ Save disabled — converting a Cash/Bank payment to Adjustment/Asset would break the safe_cash_amount invariant. Delete and re-create instead.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || locked || invariantWouldFail}
              title={
                locked
                  ? "Toggle Payment Type, Amount, or Payment Head to unlock"
                  : invariantWouldFail
                    ? "Impact preview shows the safe_cash_amount invariant would fail"
                    : undefined
              }
            >
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {isEdit ? "Save changes" : "Record payment"}
            </Button>
          </div>
        </div>
      </div>

      <PaymentBlockedAuditDrawer
        open={auditDrawerOpen}
        onOpenChange={setAuditDrawerOpen}
        audit={blockedAudit}
        attempted={blockedPayload}
      />
    </div>
  );
}
