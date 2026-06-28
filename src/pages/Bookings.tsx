import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { fmtPKR } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Eye, Pencil, Receipt, BookOpen, FilePlus2, MessageCircle, Plus, Search, MoreHorizontal,
} from "lucide-react";
import { BookingForm } from "@/components/BookingForm";
import { fetchDocSummaries } from "@/lib/bookingDocuments";
import { cn } from "@/lib/utils";

const STATUSES = ["All", "Active", "Completed", "Cancelled", "Transferred"];
const RISKS = ["All", "HIGH", "MEDIUM", "LOW"];

function buildWaUrl(b: any) {
  const raw = String(b.mobile ?? "").replace(/[^\d]/g, "");
  if (!raw) return "";
  const phone = raw.startsWith("0") ? "92" + raw.slice(1)
    : raw.startsWith("92") ? raw
    : raw.length === 10 ? "92" + raw
    : raw;
  const overdue = Number(b.current_overdue_count || 0);
  const amount = Number(b.total_overdue_amount || 0);
  const msg = overdue > 0
    ? `Dear ${b.client_name},\n\nReminder from Precise Realtors & Builders regarding unit ${b.unit_id} (booking ${b.booking_id}).\n\nYou have ${overdue} overdue installment(s) totalling PKR ${amount.toLocaleString("en-PK")}. Kindly arrange payment at your earliest convenience.\n\nThank you.`
    : `Dear ${b.client_name},\n\nGreetings from Precise Realtors & Builders regarding your booking ${b.booking_id} for unit ${b.unit_id}.\n\nThank you.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

export default function Bookings() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState("All");
  const [risk, setRisk] = useState("All");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["bookings"],
    queryFn: async () =>
      (await supabase.from("bookings").select("*").order("booking_date", { ascending: false })).data ?? [],
  });

  const { data: docSummaries = {} } = useQuery({
    queryKey: ["booking-document-summaries"],
    queryFn: fetchDocSummaries,
  });

  const filtered = useMemo(() => {
    const lq = search.trim().toLowerCase();
    return rows.filter((b: any) => {
      if (status !== "All" && (b.booking_status ?? "") !== status) return false;
      if (risk !== "All" && (b.risk_level ?? "") !== risk) return false;
      if (overdueOnly && !(Number(b.current_overdue_count) > 0)) return false;
      if (!lq) return true;
      return [b.client_name, b.cnic, b.booking_id, b.unit_id]
        .some((v) => String(v ?? "").toLowerCase().includes(lq));
    });
  }, [rows, status, risk, overdueOnly, search]);

  return (
    <div>
      <PageHeader
        title="Bookings"
        description={`${rows.length} bookings · Manal Arcade`}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New booking
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="card-elevated p-3 mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Client, CNIC, or Booking ID…"
            className="pl-9 bg-muted/40 border-transparent h-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Risk</Label>
          <Select value={risk} onValueChange={setRisk}>
            <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>{RISKS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Switch id="overdue-only" checked={overdueOnly} onCheckedChange={setOverdueOnly} />
          <Label htmlFor="overdue-only" className="text-xs">Overdue only</Label>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">{filtered.length} of {rows.length}</div>
      </div>

      {/* Table */}
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto max-h-[68vh]">
          <table className="w-full text-sm table-sticky">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 border-b">Booking ID</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Client</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Unit</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Type</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Contract Value</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Cash Received</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Overdue</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Status</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Risk</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Docs</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="text-center text-muted-foreground p-8">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-muted-foreground p-10">No bookings match these filters.</td></tr>
              ) : filtered.map((b: any) => {
                const wa = buildWaUrl(b);
                return (
                  <tr key={b.booking_id} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link to={`/bookings/${b.booking_id}`} className="font-mono text-xs text-primary hover:underline">{b.booking_id}</Link>
                    </td>
                    <td className="px-4 py-2.5 capitalize font-medium">{b.client_name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{b.unit_id}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{b.unit_type ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtPKR(b.total_contract_value)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtPKR(b.cash_received)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {Number(b.current_overdue_count) > 0
                        ? <span className="text-destructive font-semibold">{b.current_overdue_count}</span>
                        : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge label={b.booking_status} tone={statusTone(b.booking_status)} /></td>
                    <td className="px-4 py-2.5"><StatusBadge label={b.risk_level} tone={statusTone(b.risk_level)} /></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="View" onClick={() => navigate(`/bookings/${b.booking_id}`)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => setEditing(b)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {wa && (
                          <a href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp"
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-success hover:bg-success/10">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/payments?booking=${b.booking_id}`)}>
                              <Receipt className="h-4 w-4 mr-2" /> Payments
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/ledger?booking=${b.booking_id}`)}>
                              <BookOpen className="h-4 w-4 mr-2" /> Ledger
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/documents?booking=${b.booking_id}`)}>
                              <FilePlus2 className="h-4 w-4 mr-2" /> Documents
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New booking</DialogTitle>
            <DialogDescription>Manal Arcade — fill in client and payment plan details.</DialogDescription>
          </DialogHeader>
          <BookingForm
            onCancel={() => setCreateOpen(false)}
            onSaved={(id) => {
              setCreateOpen(false);
              qc.invalidateQueries({ queryKey: ["bookings"] });
              navigate(`/bookings/${id}`);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit booking {editing?.booking_id}</DialogTitle>
            <DialogDescription>{editing?.client_name} · {editing?.unit_id}</DialogDescription>
          </DialogHeader>
          {editing && (
            <BookingForm
              initial={editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                qc.invalidateQueries({ queryKey: ["bookings"] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
