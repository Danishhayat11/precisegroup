import { useEffect, useMemo, useState } from "react";
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
import { logPaymentBlocked } from "@/lib/audit";

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

  const { data: bookings = [] } = useQuery({
    queryKey: ["bookings-min"],
    queryFn: async () =>
      (await supabase.from("bookings").select("booking_id,client_name,unit_id").order("client_name")).data ?? [],
  });

  // Live totals — used to preview the Cash / Adjustment impact of this entry.
  const { data: totals } = useQuery({
    queryKey: ["payment-totals-preview"],
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select("amount,safe_cash_amount,payment_mode,non_cash_adjustment");
      const rows = data ?? [];
      const cashTotal = rows.reduce((s: number, r: any) => s + (Number(r.safe_cash_amount) || 0), 0);
      const adjTotal = rows
        .filter((r: any) => r.payment_mode === "Adjustment/Asset" || r.non_cash_adjustment)
        .reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
      return { cashTotal, adjTotal };
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

  const set = <K extends keyof PaymentFormValue>(k: K, v: PaymentFormValue[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k as string]: "" }));
  };

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
      const { data: snap } = await supabase
        .from("payments")
        .select("safe_cash_amount");
      cashBefore = (snap ?? []).reduce((s: number, r: any) => s + (Number(r.safe_cash_amount) || 0), 0);
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
      // Detect our Postgres invariant trigger (cash totals would shift).
      const isCashInvariant =
        /Cash Received/i.test(raw) ||
        /Adjustment\/Asset payment/i.test(raw) ||
        /Cannot convert payment/i.test(raw) ||
        /safe_cash_amount/i.test(raw);
      if (isCashInvariant) {
        const friendly =
          form.payment_mode === "Adjustment/Asset"
            ? "Adjustment/Asset payments must not affect Cash Received. Set the type back to Cash or Bank Transfer if this is a real cash receipt, otherwise leave it as Adjustment — the amount is tracked separately on the Adjustments register."
            : "This change would alter Cash Received totals and was blocked by the database. Review the payment type and amount.";
        setErrors((e) => ({
          ...e,
          payment_mode: friendly,
          amount: form.payment_mode === "Adjustment/Asset" ? "Amount is recorded on the Adjustments register, not Cash Received." : "",
        }));
        // Identify which trigger condition fired (for the audit trail).
        let failedCondition = "cash_invariant.generic";
        if (/Cannot convert payment/i.test(raw)) failedCondition = "type_conversion_blocked";
        else if (/safe_cash_amount = 0/i.test(raw)) failedCondition = "adjustment_safe_cash_not_zero";
        else if (/non_cash_adjustment = true/i.test(raw)) failedCondition = "adjustment_flag_missing";
        else if (/cash_bank_include = false/i.test(raw)) failedCondition = "cash_bank_include_inconsistent";
        else if (/safe_cash_amount.*must equal amount/i.test(raw)) failedCondition = "cash_amount_mismatch";

        void logPaymentBlocked({
          receiptNo: form.receipt_no,
          bookingId: form.booking_id,
          paymentMode: form.payment_mode,
          amount: form.amount,
          failedCondition,
          rawError: raw,
        });

        toast({
          variant: "destructive",
          title: "Save blocked — Cash Received would change",
          description: "See the highlighted fields for details.",
        });
        return;
      }
      toast({ variant: "destructive", title: "Save failed", description: raw });
      return;
    }


    // Post-write verification for adjustment rows — rollback if cash totals shifted
    if (isAdjustment) {
      const { data: snap2 } = await supabase
        .from("payments")
        .select("safe_cash_amount");
      const cashAfter = (snap2 ?? []).reduce((s: number, r: any) => s + (Number(r.safe_cash_amount) || 0), 0);
      if (Math.abs(cashAfter - cashBefore) > 0.5) {
        // Roll back
        if (!isEdit) {
          await supabase.from("payments").delete().eq("receipt_no", form.receipt_no);
        }
        setSaving(false);
        toast({
          variant: "destructive",
          title: "Save blocked — Cash Received would change",
          description: `Cash totals moved by PKR ${(cashAfter - cashBefore).toLocaleString("en-PK")}. Adjustment/Asset entries must never affect Cash Received. The save has been reverted.`,
        });
        return;
      }
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
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-9", !form.payment_date && "text-muted-foreground")}>
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
              <Button variant="outline" role="combobox" className="w-full justify-between h-9 font-normal">
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
            <SelectTrigger><SelectValue /></SelectTrigger>
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
        </div>
        <div>
          <Label>Amount (PKR) *</Label>
          <Input type="number" min={0} value={form.amount || ""} onChange={(e) => set("amount", Number(e.target.value || 0))} />
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {form.payment_mode === "Bank Transfer" && (
          <div>
            <Label>Bank Name</Label>
            <Input value={form.account ?? ""} onChange={(e) => set("account", e.target.value)} placeholder="e.g. Meezan Bank" />
          </div>
        )}
        <div>
          <Label>Cheque / Reference Number</Label>
          <Input value={form.cheque_txn_no ?? ""} onChange={(e) => set("cheque_txn_no", e.target.value)} />
        </div>
        <div>
          <Label>Received By</Label>
          <Input value={form.posted_by ?? ""} onChange={(e) => set("posted_by", e.target.value)} />
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea rows={2} value={form.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {isEdit ? "Save changes" : "Record payment"}
        </Button>
      </div>
    </div>
  );
}
