import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { addMonths, format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { fmtPKR } from "@/lib/format";

// Spec types
const UNIT_TYPES = ["Apartment", "Shop", "Office"] as const;
const FLOORS = ["LG", "Ground", "1st", "2nd", "3rd", "4th", "5th"] as const;
const FREQUENCIES = ["Quarterly", "Monthly", "Half-Yearly", "Yearly"] as const;
const STATUSES = ["Active", "Completed", "Cancelled", "Transferred"] as const;

const cnicRegex = /^\d{5}-\d{7}-\d$/;
const bookingSchema = z.object({
  booking_id: z.string().regex(/^BK-MA-\d{5}$/, "Booking ID must be BK-MA-XXXXX"),
  booking_date: z.string().min(1, "Booking date is required"),
  unit_id: z.string().trim().min(1, "Unit ID is required").max(40),
  unit_type: z.enum(UNIT_TYPES),
  floor: z.enum(FLOORS),
  size_sqft: z.number().nonnegative(),
  client_name: z.string().trim().min(1, "Client name is required").max(120),
  so_wo: z.string().trim().max(120).optional().or(z.literal("")),
  cnic: z.string().regex(cnicRegex, "CNIC must be XXXXX-XXXXXXX-X").or(z.literal("")),
  mobile: z.string().trim().max(20).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  dealer_name: z.string().trim().max(120).optional().or(z.literal("")),
  dealer_commission_pct: z.number().min(0).max(100),
  dealer_commission_fixed: z.number().min(0),
  sold_rate: z.number().min(0),
  down_payment: z.number().min(0),
  adjustment_credit: z.number().min(0),
  possession_amount: z.number().min(0),
  no_of_installments: z.number().int().min(0),
  installment_frequency: z.enum(FREQUENCIES),
  installment_amount: z.number().min(0),
  first_installment_due: z.string().optional().or(z.literal("")),
  booking_status: z.enum(STATUSES),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type BookingFormValue = z.infer<typeof bookingSchema>;

interface BookingFormProps {
  initial?: Partial<BookingFormValue> & { adjustment_realized?: number };
  onSaved: (id: string) => void;
  onCancel: () => void;
}

const defaultsFor = (initial?: Partial<BookingFormValue>): BookingFormValue => ({
  booking_id: initial?.booking_id ?? "",
  booking_date: initial?.booking_date ?? format(new Date(), "yyyy-MM-dd"),
  unit_id: initial?.unit_id ?? "",
  unit_type: (initial?.unit_type as any) ?? "Apartment",
  floor: (initial?.floor as any) ?? "Ground",
  size_sqft: Number(initial?.size_sqft ?? 0),
  client_name: initial?.client_name ?? "",
  so_wo: initial?.so_wo ?? "",
  cnic: initial?.cnic ?? "",
  mobile: initial?.mobile ?? "",
  address: initial?.address ?? "",
  dealer_name: initial?.dealer_name ?? "",
  dealer_commission_pct: Number(initial?.dealer_commission_pct ?? 0),
  dealer_commission_fixed: Number(initial?.dealer_commission_fixed ?? 0),
  sold_rate: Number(initial?.sold_rate ?? 0),
  down_payment: Number(initial?.down_payment ?? 0),
  adjustment_credit: Number(initial?.adjustment_credit ?? 0),
  possession_amount: Number(initial?.possession_amount ?? 0),
  no_of_installments: Number(initial?.no_of_installments ?? 0),
  installment_frequency: (initial?.installment_frequency as any) ?? "Quarterly",
  installment_amount: Number(initial?.installment_amount ?? 0),
  first_installment_due: initial?.first_installment_due ?? "",
  booking_status: (initial?.booking_status as any) ?? "Active",
  notes: initial?.notes ?? "",
});

async function nextBookingId() {
  const { data } = await supabase
    .from("bookings")
    .select("booking_id")
    .like("booking_id", "BK-MA-%");
  const maxN = (data ?? []).reduce((m, r) => {
    const n = Number(String(r.booking_id).replace("BK-MA-", ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `BK-MA-${String(maxN + 1).padStart(5, "0")}`;
}

export function BookingForm({ initial, onSaved, onCancel }: BookingFormProps) {
  const { toast } = useToast();
  const isEdit = Boolean(initial?.booking_id);
  const [form, setForm] = useState<BookingFormValue>(defaultsFor(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [installmentDirty, setInstallmentDirty] = useState(isEdit);

  // Auto-assign new ID
  useEffect(() => {
    if (!isEdit && !form.booking_id) {
      nextBookingId().then((id) => setForm((f) => ({ ...f, booking_id: id })));
    }
  }, [isEdit, form.booking_id]);

  // Auto-calculated values
  const calc = useMemo(() => {
    const soldUnitValue = form.sold_rate * form.size_sqft;
    const totalDownPayment = form.down_payment + form.adjustment_credit;
    const installmentBase = Math.max(soldUnitValue - totalDownPayment - form.possession_amount, 0);
    const suggestedInstallment = form.no_of_installments > 0
      ? Math.round(installmentBase / form.no_of_installments)
      : 0;
    const planTotal = totalDownPayment + form.installment_amount * form.no_of_installments + form.possession_amount;
    const planMatches = Math.abs(planTotal - soldUnitValue) < 1;
    const dealerCommissionAmount = soldUnitValue * (form.dealer_commission_pct / 100) + form.dealer_commission_fixed;
    return { soldUnitValue, totalDownPayment, installmentBase, suggestedInstallment, planTotal, planMatches, dealerCommissionAmount };
  }, [form]);

  // Default installment amount = suggested, until user overrides it
  useEffect(() => {
    if (!installmentDirty) setForm((f) => ({ ...f, installment_amount: calc.suggestedInstallment }));
  }, [calc.suggestedInstallment, installmentDirty]);

  const set = <K extends keyof BookingFormValue>(k: K, v: BookingFormValue[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k as string]: "" }));
  };
  const setNum = (k: keyof BookingFormValue) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, Number(e.target.value || 0) as any);

  const handleSave = async () => {
    const parsed = bookingSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { errs[i.path.join(".")] = i.message; });
      setErrors(errs);
      toast({ variant: "destructive", title: "Please fix the highlighted fields" });
      return;
    }
    setSaving(true);
    const payload = {
      booking_id: form.booking_id,
      booking_date: form.booking_date,
      project_code: "MA",
      project_name: "Manal Arcade",
      unit_id: form.unit_id,
      unit_type: form.unit_type,
      floor: form.floor,
      size_sqft: form.size_sqft,
      client_name: form.client_name,
      so_wo: form.so_wo || null,
      cnic: form.cnic || null,
      mobile: form.mobile || null,
      address: form.address || null,
      dealer_name: form.dealer_name || null,
      dealer_commission_pct: form.dealer_commission_pct,
      dealer_commission_fixed: form.dealer_commission_fixed,
      dealer_commission_amount: calc.dealerCommissionAmount,
      sold_rate: form.sold_rate,
      sold_unit_value: calc.soldUnitValue,
      total_contract_value: calc.soldUnitValue,
      down_payment: form.down_payment,
      adjustment_credit: form.adjustment_credit,
      possession_amount: form.possession_amount,
      no_of_installments: form.no_of_installments,
      installment_frequency: form.installment_frequency,
      installment_amount: form.installment_amount,
      first_installment_due: form.first_installment_due || null,
      booking_status: form.booking_status,
      notes: form.notes || null,
    };
    const { error } = isEdit
      ? await supabase.from("bookings").update(payload).eq("booking_id", form.booking_id)
      : await supabase.from("bookings").insert(payload);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Save failed", description: error.message });
      return;
    }
    toast({ title: isEdit ? "Booking updated" : "Booking created", description: form.booking_id });
    onSaved(form.booking_id);
  };

  const Err = ({ k }: { k: string }) =>
    errors[k] ? <p className="text-[11px] text-destructive mt-1">{errors[k]}</p> : null;

  const DatePick = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-9", !value && "text-muted-foreground")}>
          <CalendarIcon className="h-4 w-4 mr-2" />
          {value ? format(new Date(value), "dd-MMM-yyyy") : <span>{placeholder}</span>}
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

  return (
    <div className="space-y-6">
      {/* Identity */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label>Booking ID</Label>
          <Input value={form.booking_id} readOnly className="bg-muted/60 font-mono" />
        </div>
        <div>
          <Label>Booking Date *</Label>
          <DatePick value={form.booking_date} onChange={(v) => set("booking_date", v)} placeholder="Select date" />
          <Err k="booking_date" />
        </div>
        <div>
          <Label>Project Name</Label>
          <Input value="Manal Arcade" readOnly className="bg-muted/60" />
        </div>
      </section>

      {/* Unit */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-2">Unit</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label>Unit ID *</Label>
            <Input value={form.unit_id} onChange={(e) => set("unit_id", e.target.value.toUpperCase())} placeholder="MA-AP-301" className="font-mono" />
            <Err k="unit_id" />
          </div>
          <div>
            <Label>Unit Type *</Label>
            <Select value={form.unit_type} onValueChange={(v) => set("unit_type", v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{UNIT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Floor *</Label>
            <Select value={form.floor} onValueChange={(v) => set("floor", v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FLOORS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Size (Sqft)</Label>
            <Input type="number" min={0} value={form.size_sqft || ""} onChange={setNum("size_sqft")} />
          </div>
        </div>
      </section>

      {/* Client */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-2">Client</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Client Name *</Label>
            <Input value={form.client_name} onChange={(e) => set("client_name", e.target.value)} />
            <Err k="client_name" />
          </div>
          <div>
            <Label>Father / Husband Name</Label>
            <Input value={form.so_wo ?? ""} onChange={(e) => set("so_wo", e.target.value)} />
          </div>
          <div>
            <Label>CNIC</Label>
            <Input
              value={form.cnic}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 13);
                let masked = digits;
                if (digits.length > 5) masked = digits.slice(0, 5) + "-" + digits.slice(5);
                if (digits.length > 12) masked = digits.slice(0, 5) + "-" + digits.slice(5, 12) + "-" + digits.slice(12);
                set("cnic", masked);
              }}
              onBlur={() => {
                if (form.cnic && !cnicRegex.test(form.cnic)) {
                  setErrors((er) => ({ ...er, cnic: "CNIC must be XXXXX-XXXXXXX-X (13 digits)" }));
                }
              }}
              inputMode="numeric"
              maxLength={15}
              placeholder="XXXXX-XXXXXXX-X"
              className={cn("font-mono", errors.cnic && "border-destructive focus-visible:ring-destructive")}
            />
            <Err k="cnic" />
          </div>
          <div>
            <Label>Mobile / WhatsApp</Label>
            <Input value={form.mobile ?? ""} onChange={(e) => set("mobile", e.target.value)} placeholder="03XX-XXXXXXX" />
          </div>
          <div className="md:col-span-2">
            <Label>Address</Label>
            <Textarea rows={2} value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
          </div>
        </div>
      </section>

      {/* Dealer */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-2">Dealer</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-1">
            <Label>Dealer Name</Label>
            <Input value={form.dealer_name ?? ""} onChange={(e) => set("dealer_name", e.target.value)} placeholder="Direct / Company" />
          </div>
          <div>
            <Label>Commission %</Label>
            <Input type="number" min={0} max={100} step="0.01" value={form.dealer_commission_pct || ""} onChange={setNum("dealer_commission_pct")} />
          </div>
          <div>
            <Label>Commission Fixed (PKR)</Label>
            <Input type="number" min={0} value={form.dealer_commission_fixed || ""} onChange={setNum("dealer_commission_fixed")} />
          </div>
          <div>
            <Label>Commission Amount</Label>
            <Input readOnly value={fmtPKR(calc.dealerCommissionAmount)} className="bg-muted/60 tabular-nums" />
          </div>
        </div>
      </section>

      {/* Pricing & Plan */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-2">Pricing & Payment Plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label>Sold Rate / Sqft (PKR)</Label>
            <Input type="number" min={0} value={form.sold_rate || ""} onChange={setNum("sold_rate")} />
          </div>
          <div>
            <Label>Sold Unit Value</Label>
            <Input readOnly value={fmtPKR(calc.soldUnitValue)} className="bg-muted/60 tabular-nums" />
          </div>
          <div>
            <Label>Down Payment Cash (PKR)</Label>
            <Input type="number" min={0} value={form.down_payment || ""} onChange={setNum("down_payment")} />
          </div>
          <div>
            <Label>Adjustment Allowed (PKR)</Label>
            <Input type="number" min={0} value={form.adjustment_credit || ""} onChange={setNum("adjustment_credit")} />
          </div>
          <div>
            <Label>Total Down Payment</Label>
            <Input readOnly value={fmtPKR(calc.totalDownPayment)} className="bg-muted/60 tabular-nums" />
          </div>
          <div>
            <Label>Adj. Asset Realized (rolled-up)</Label>
            <Input readOnly value={fmtPKR(initial?.adjustment_realized ?? 0)} className="bg-muted/60 tabular-nums" />
          </div>
          <div>
            <Label>Possession Amount (PKR)</Label>
            <Input type="number" min={0} value={form.possession_amount || ""} onChange={setNum("possession_amount")} />
          </div>
          <div>
            <Label>Installment Base</Label>
            <Input readOnly value={fmtPKR(calc.installmentBase)} className="bg-muted/60 tabular-nums" />
          </div>
          <div>
            <Label># of Installments</Label>
            <Input type="number" min={0} value={form.no_of_installments || ""} onChange={setNum("no_of_installments")} />
          </div>
          <div>
            <Label>Frequency</Label>
            <Select value={form.installment_frequency} onValueChange={(v) => set("installment_frequency", v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Suggested Installment</Label>
            <Input readOnly value={fmtPKR(calc.suggestedInstallment)} className="bg-muted/60 tabular-nums" />
          </div>
          <div>
            <Label>Installment Amount (editable)</Label>
            <Input
              type="number" min={0}
              value={form.installment_amount || ""}
              onChange={(e) => { setInstallmentDirty(true); set("installment_amount", Number(e.target.value || 0)); }}
            />
          </div>
          <div>
            <Label>First Installment Due</Label>
            <DatePick value={form.first_installment_due ?? ""} onChange={(v) => set("first_installment_due", v)} placeholder="Select date" />
          </div>
          <div className="md:col-span-2">
            <Label>Payment Plan Total</Label>
            <Input
              readOnly
              value={fmtPKR(calc.planTotal)}
              className={cn("bg-muted/60 tabular-nums", !calc.planMatches && "ring-2 ring-destructive")}
            />
            {!calc.planMatches && (
              <p className="text-[11px] text-destructive mt-1">
                Plan total must equal Sold Unit Value ({fmtPKR(calc.soldUnitValue)}). Difference: {fmtPKR(calc.planTotal - calc.soldUnitValue)}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Payment Plan Preview */}
      <PaymentPlanPreview
        firstDue={form.first_installment_due}
        count={form.no_of_installments}
        amount={form.installment_amount}
        frequency={form.installment_frequency}
        downPaymentCash={form.down_payment}
        adjustmentCredit={form.adjustment_credit}
        possessionAmount={form.possession_amount}
        bookingDate={form.booking_date}
      />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label>Status</Label>
          <Select value={form.booking_status} onValueChange={(v) => set("booking_status", v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </section>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {isEdit ? "Save changes" : "Create booking"}
        </Button>
      </div>
    </div>
  );
}

function PaymentPlanPreview({
  firstDue, count, amount, frequency, downPaymentCash, adjustmentCredit, possessionAmount, bookingDate,
}: {
  firstDue: string;
  count: number;
  amount: number;
  frequency: typeof FREQUENCIES[number];
  downPaymentCash: number;
  adjustmentCredit: number;
  possessionAmount: number;
  bookingDate: string;
}) {
  const monthStep = frequency === "Monthly" ? 1 : frequency === "Quarterly" ? 3 : frequency === "Half-Yearly" ? 6 : 12;
  const start = firstDue ? new Date(firstDue) : null;

  const rows: { sr: number; particulars: string; due: string; amount: number }[] = [];
  let sr = 1;

  if (downPaymentCash > 0) {
    rows.push({ sr: sr++, particulars: "Down Payment (Cash)", due: bookingDate, amount: downPaymentCash });
  }
  if (adjustmentCredit > 0) {
    rows.push({ sr: sr++, particulars: "Adjustment Allowed", due: bookingDate, amount: adjustmentCredit });
  }

  if (start && count > 0 && amount > 0) {
    for (let i = 0; i < count; i++) {
      const d = addMonths(start, i * monthStep);
      rows.push({
        sr: sr++,
        particulars: `Installment ${i + 1} of ${count}`,
        due: format(d, "yyyy-MM-dd"),
        amount,
      });
    }
  }

  if (possessionAmount > 0) {
    const possDate = start && count > 0
      ? format(addMonths(start, count * monthStep), "yyyy-MM-dd")
      : "";
    rows.push({ sr: sr++, particulars: "Possession Amount", due: possDate, amount: possessionAmount });
  }

  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <section>
      <h3 className="text-sm font-semibold text-primary mb-2">Payment Plan Preview</h3>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground border rounded-md p-4 bg-muted/30">
          Enter installment count, amount, and first due date to preview the schedule.
        </div>
      ) : (
        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2 w-12">#</th>
                <th className="text-left font-medium px-3 py-2">Particulars</th>
                <th className="text-left font-medium px-3 py-2">Due Date</th>
                <th className="text-right font-medium px-3 py-2">Amount (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.sr} className={cn("border-t", idx % 2 === 1 && "bg-muted/20")}>
                  <td className="px-3 py-2 tabular-nums">{r.sr}</td>
                  <td className="px-3 py-2">{r.particulars}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.due ? format(new Date(r.due), "dd-MMM-yyyy") : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 font-semibold">
                <td colSpan={3} className="px-3 py-2 text-right">Plan Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

