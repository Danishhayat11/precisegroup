import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, AlertTriangle, Building2, Wallet, Scale, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtPKR } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface BookingSummary {
  booking_id: string;
  client_name: string;
  unit_id: string;
  floor: string | null;
  unit_type: string | null;
  total_contract_value: number;
  cash_received: number;
  remaining_balance: number;
  current_overdue_count: number;
  total_overdue_amount: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  raw: Record<string, unknown>;
}

interface Props {
  value: string | null;
  onChange: (bookingId: string | null, booking: BookingSummary | null) => void;
}

type RiskTone = "LOW" | "MEDIUM" | "HIGH";

/** Derive a risk band when the stored `risk_level` is missing/non-canonical. */
function deriveRisk(overdueCount: number, stored?: string | null): RiskTone {
  const s = (stored ?? "").toUpperCase();
  if (s === "LOW" || s === "MEDIUM" || s === "HIGH") return s as RiskTone;
  if (overdueCount >= 3) return "HIGH";
  if (overdueCount >= 1) return "MEDIUM";
  return "LOW";
}

function toSummary(b: Record<string, any>): BookingSummary {
  const overdue = Number(b.current_overdue_count ?? 0);
  return {
    booking_id: b.booking_id,
    client_name: b.client_name ?? "",
    unit_id: b.unit_id ?? "",
    floor: b.floor ?? null,
    unit_type: b.unit_type ?? null,
    total_contract_value: Number(b.total_contract_value ?? 0),
    cash_received: Number(b.cash_received ?? 0),
    remaining_balance: Number(b.remaining_balance ?? 0),
    current_overdue_count: overdue,
    total_overdue_amount: Number(b.total_overdue_amount ?? 0),
    risk_level: deriveRisk(overdue, b.risk_level),
    raw: b as Record<string, unknown>,
  };
}

const RISK_STYLES: Record<RiskTone, { tone: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  LOW:    { tone: "bg-emerald-100 text-emerald-800 border-emerald-300",  label: "Low risk",    icon: ShieldAlert },
  MEDIUM: { tone: "bg-amber-100 text-amber-900 border-amber-300",        label: "Medium risk", icon: ShieldAlert },
  HIGH:   { tone: "bg-destructive/15 text-destructive border-destructive/40", label: "High risk", icon: AlertTriangle },
};

/**
 * Section B — Document Center booking selector.
 *
 * Search the bookings table by client name / booking id / unit / CNIC, then
 * surface a summary card with everything the downstream document generators
 * need to auto-fill: contract value, paid, balance, overdue count + amount,
 * and the risk band.
 */
export function BookingSelector({ value, onChange }: Props) {
  const [search, setSearch] = useState("");

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["doc-center-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          "booking_id,client_name,cnic,unit_id,floor,unit_type,total_contract_value,cash_received,remaining_balance,current_overdue_count,total_overdue_amount,risk_level"
        )
        .order("client_name");
      if (error) throw error;
      return (data ?? []).map(toSummary);
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookings.slice(0, 25);
    return bookings
      .filter((b) =>
        [b.booking_id, b.client_name, b.unit_id, b.raw.cnic]
          .some((v) => String(v ?? "").toLowerCase().includes(q))
      )
      .slice(0, 25);
  }, [bookings, search]);

  const selected = useMemo(
    () => bookings.find((b) => b.booking_id === value) ?? null,
    [bookings, value]
  );

  // List view -----------------------------------------------------------------
  if (!selected) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-semibold">Select a booking</div>
            <div className="text-xs text-muted-foreground">
              Search by client name, booking ID, unit, or CNIC
            </div>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Ahmed, MA-0042, B-17…"
              className="pl-8"
              aria-label="Search bookings"
            />
          </div>
        </div>

        <div className="border rounded-md max-h-80 overflow-y-auto divide-y" role="listbox">
          {isLoading && (
            <div className="p-4 text-sm text-muted-foreground">Loading bookings…</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              No bookings match “{search}”.
            </div>
          )}
          {filtered.map((b) => {
            const risk = RISK_STYLES[b.risk_level];
            return (
              <button
                key={b.booking_id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onChange(b.booking_id, b)}
                className="w-full text-left p-3 hover:bg-muted flex items-center justify-between gap-3 transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-medium capitalize truncate">{b.client_name || "—"}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {b.booking_id} · {b.unit_id || "no unit"}
                    {b.floor && <> · Floor {b.floor}</>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs tabular-nums">
                    Balance:{" "}
                    <span className="font-semibold">PKR {fmtPKR(b.remaining_balance)}</span>
                  </div>
                  <div className="text-[11px] mt-0.5 flex items-center justify-end gap-1.5">
                    {b.current_overdue_count > 0 && (
                      <span className="text-destructive font-semibold">
                        {b.current_overdue_count} overdue
                      </span>
                    )}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold",
                        risk.tone
                      )}
                    >
                      <risk.icon className="h-2.5 w-2.5" />
                      {b.risk_level}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    );
  }

  // Summary card -------------------------------------------------------------
  const risk = RISK_STYLES[selected.risk_level];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Selected booking
          </div>
          <div className="text-lg font-semibold capitalize leading-tight">
            {selected.client_name || "—"}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {selected.booking_id}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(null, null)}
          aria-label="Change booking"
        >
          <X className="h-4 w-4 mr-1" />
          Change
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat
          icon={Building2}
          label="Unit"
          value={selected.unit_id || "—"}
          sub={
            [selected.unit_type, selected.floor && `Floor ${selected.floor}`]
              .filter(Boolean).join(" · ") || undefined
          }
          mono
        />
        <Stat
          icon={Scale}
          label="Contract value"
          value={`PKR ${fmtPKR(selected.total_contract_value)}`}
        />
        <Stat
          icon={Wallet}
          label="Total paid"
          value={`PKR ${fmtPKR(selected.cash_received)}`}
          tone="success"
        />
        <Stat
          icon={Wallet}
          label="Balance"
          value={`PKR ${fmtPKR(selected.remaining_balance)}`}
          tone={selected.remaining_balance > 0 ? "warn" : "success"}
        />
        <Stat
          icon={AlertTriangle}
          label="Overdue installments"
          value={String(selected.current_overdue_count)}
          sub={
            selected.total_overdue_amount > 0
              ? `PKR ${fmtPKR(selected.total_overdue_amount)} outstanding`
              : "None outstanding"
          }
          tone={selected.current_overdue_count > 0 ? "danger" : "muted"}
        />
        <div className="col-span-2 md:col-span-3 flex items-end">
          <div className="w-full">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Risk level
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn("text-xs px-2.5 py-1 gap-1.5", risk.tone)}
              >
                <risk.icon className="h-3 w-3" />
                {risk.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {selected.risk_level === "HIGH"
                  ? "Escalation documents recommended."
                  : selected.risk_level === "MEDIUM"
                  ? "Demand notice recommended."
                  : "Account in good standing."}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Stat({
  icon: Icon, label, value, sub, mono, tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  tone?: "default" | "success" | "warn" | "danger" | "muted";
}) {
  const toneCls = {
    default: "text-foreground",
    success: "text-emerald-700",
    warn:    "text-amber-700",
    danger:  "text-destructive",
    muted:   "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded-md border bg-muted/30 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-semibold tabular-nums leading-tight",
          mono && "font-mono text-[13px]",
          toneCls
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
