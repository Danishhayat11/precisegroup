import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { fmtPKR, compact } from "@/lib/format";
import { Link } from "react-router-dom";
import { ArrowUpRight, Banknote, Wallet, AlertTriangle, Building2, Repeat2, CheckCircle2, Coins, MessageCircle, Eye } from "lucide-react";
import { fmtDate } from "@/lib/format";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [bookings, payments, ledger, adj, units, projects] = await Promise.all([
        supabase.from("bookings").select("*"),
        supabase.from("payments").select("*"),
        supabase.from("installment_ledger").select("*"),
        supabase.from("adjustments").select("*"),
        supabase.from("units").select("status,project_code"),
        supabase.from("projects").select("project_code,project_name"),
      ]);
      return {
        bookings: bookings.data ?? [],
        payments: payments.data ?? [],
        ledger: ledger.data ?? [],
        adjustments: adj.data ?? [],
        units: units.data ?? [],
        projects: projects.data ?? [],
      };
    },
  });

  if (isLoading || !data) return <div className="text-muted-foreground">Loading…</div>;

  const today = new Date().toISOString().slice(0, 10);
  const totalSellValue = data.bookings.reduce((s: number, b: any) => s + (Number(b.sold_unit_value) || 0), 0);
  const totalContract = data.bookings.reduce((s: number, b: any) => s + (Number(b.total_contract_value) || 0), 0);
  // Cash Recovered: bank/cash receipts only (safe_cash_amount excludes adjustment-mode rows)
  const cashRecovered = data.payments.reduce((s: number, p: any) => s + (Number(p.safe_cash_amount) || 0), 0);
  // Adjustment totals from the adjustments register
  const adjApproved = data.adjustments.reduce((s: number, a: any) => s + (Number(a.approved_value) || 0), 0);
  const adjRealised = data.adjustments.reduce((s: number, a: any) => s + (Number(a.realized_value) || 0), 0);
  // Total Received = Cash Recovered + Adjustment Realised (cash-equivalent inflow to company).
  const totalReceived = cashRecovered + adjRealised;
  // Pending Balance = Total Sell Value − Total Received.
  const pendingBalance = Math.max(totalSellValue - totalReceived, 0);

  const overdueRows = data.ledger.filter((l: any) => {
    const isInstallment = !/down payment|possession/i.test(l.particulars ?? "");
    const due = Number(l.due_amount) || 0;
    const paid = Number(l.paid_amount) || 0;
    return isInstallment && l.due_date && l.due_date < today && due - paid > 0;
  });
  const overdueValue = overdueRows.reduce((s: number, l: any) => s + Math.max((Number(l.due_amount) || 0) - (Number(l.paid_amount) || 0), 0), 0);

  const recoveryPct = totalSellValue > 0 ? Math.round((totalReceived / totalSellValue) * 100) : 0;

  const unitStatus = data.units.reduce((acc: Record<string, number>, u: any) => {
    acc[u.status ?? "Unknown"] = (acc[u.status ?? "Unknown"] ?? 0) + 1; return acc;
  }, {});

  const byProject = data.projects.map((p: any) => {
    const sold = data.bookings.filter((b: any) => b.project_code === p.project_code).reduce((s: number, b: any) => s + (Number(b.sold_unit_value) || 0), 0);
    return { name: p.project_name, sold };
  });

  const modeBreakdown = Object.entries(
    data.payments.reduce((acc: Record<string, number>, p: any) => {
      const m = p.payment_mode ?? "Other";
      acc[m] = (acc[m] ?? 0) + (Number(p.safe_cash_amount) || 0);
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value: value as number }));

  // Overdue clients table — HIGH (3+) / MEDIUM (1-2). Skip LOW / zero.
  const overdueClients = [...data.bookings]
    .map((b: any) => ({ ...b, _ov: Number(b.current_overdue_count || 0), _amt: Number(b.total_overdue_amount || 0) }))
    .filter((b: any) => b._ov > 0)
    .map((b: any) => ({ ...b, _risk: b._ov >= 3 ? "HIGH" : "MEDIUM" }))
    .sort((a: any, b: any) => b._amt - a._amt);

  const kpis = [
    { label: "Total Sell Value", val: fmtPKR(totalSellValue), sub: `${data.bookings.length} bookings`, icon: Building2 },
    { label: "Cash Recovered", val: fmtPKR(cashRecovered), sub: "Cash / bank only — excludes adjustments", icon: Banknote },
    { label: "Total Adjustment Approved", val: fmtPKR(adjApproved), sub: `${data.adjustments.length} adjustments approved`, icon: Repeat2 },
    { label: "Total Adjustment Realised", val: fmtPKR(adjRealised), sub: "Assets realised by company", icon: Coins },
    { label: "Total Received", val: fmtPKR(totalReceived), sub: `Cash + Adj. Realised · ${recoveryPct}% of sell value`, icon: CheckCircle2 },
    { label: "Total Pending Balance", val: fmtPKR(pendingBalance), sub: "Sell value − received", icon: Wallet },
    { label: "Current Overdue Amount", val: fmtPKR(overdueValue), sub: `${overdueRows.length} overdue installments`, icon: AlertTriangle },
  ] as const;
  void totalContract; // retained for future use

  const COLORS = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--adjustment))", "hsl(var(--muted-foreground))"];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Live KPIs powered by your booking, payment, and installment data."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3 mb-6">
        {kpis.map((k) => (
          <div key={k.label} className="kpi-tile">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-muted-foreground font-medium">{k.label}</div>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-xl font-semibold tabular-nums">{k.val}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card-elevated p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold">Project-wise sales</div>
              <div className="text-xs text-muted-foreground">Total contract value per project</div>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={byProject} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => fmtPKR(Number(v))} cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="sold" radius={[8, 8, 0, 0]}>
                  {byProject.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-elevated p-5">
          <div className="text-sm font-semibold mb-1">Payment mode breakdown</div>
          <div className="text-xs text-muted-foreground mb-3">Safe-cash share by mode</div>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={modeBreakdown} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2}>
                  {modeBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => fmtPKR(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card-elevated overflow-hidden border-l-4 border-l-destructive">
        <div className="flex items-center justify-between p-5 pb-3">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Overdue clients
            </div>
            <div className="text-xs text-muted-foreground">Clients with at least one overdue installment. HIGH = 3+ overdue, MEDIUM = 1–2.</div>
          </div>
          <Link to="/bookings" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            View all bookings <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-5 py-2.5">Client Name</th>
                <th className="text-left font-medium px-3 py-2.5">Unit</th>
                <th className="text-right font-medium px-3 py-2.5">Installments Overdue</th>
                <th className="text-right font-medium px-3 py-2.5">Overdue Amount (PKR)</th>
                <th className="text-left font-medium px-5 py-2.5">Risk Level</th>
                <th className="text-left font-medium px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {overdueClients.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-muted-foreground p-8">No overdue clients — you're current.</td></tr>
              ) : overdueClients.map((b: any) => {
                const isHigh = b._risk === "HIGH";
                const rawPhone = String(b.mobile ?? "").replace(/[^\d]/g, "");
                // Normalize to international format for wa.me (PK default)
                const waPhone = rawPhone.startsWith("0")
                  ? "92" + rawPhone.slice(1)
                  : rawPhone.startsWith("92")
                    ? rawPhone
                    : rawPhone.length === 10
                      ? "92" + rawPhone
                      : rawPhone;
                const msg = `Dear ${b.client_name},\n\nThis is a reminder from Precise Realtors & Builders regarding your unit ${b.unit_id}.\n\nYou currently have ${b._ov} overdue installment(s) with a total outstanding amount of PKR ${Number(b._amt).toLocaleString("en-PK")}.\n\nKindly arrange the payment at your earliest convenience to avoid further action.\n\nThank you.`;
                const waUrl = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}` : "";
                return (
                  <tr key={b.booking_id} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-2.5 capitalize font-medium">
                      <Link to={`/bookings/${b.booking_id}`} className="hover:text-primary hover:underline">{b.client_name}</Link>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{b.unit_id}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">{b._ov}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${isHigh ? "text-destructive" : "text-warning"}`}>{fmtPKR(b._amt)}</td>
                    <td className="px-5 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        isHigh
                          ? "bg-destructive/10 text-destructive ring-1 ring-destructive/30"
                          : "bg-warning/10 text-warning ring-1 ring-warning/30"
                      }`}>
                        {b._risk}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {waUrl ? (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md bg-success/10 text-success ring-1 ring-success/30 hover:bg-success/20 px-2.5 py-1 text-xs font-medium transition-colors"
                          title={`Send WhatsApp to ${b.mobile}`}
                        >
                          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">No phone</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>


      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
        {Object.entries(unitStatus).map(([k, v]) => (
          <div key={k} className="card-elevated p-4">
            <div className="text-xs text-muted-foreground">Units · {k}</div>
            <div className="text-xl font-semibold mt-1">{v as number}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
