import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";

const sheetMap = [
  { sheet: "PROJECTS_DB", module: "Projects", table: "projects" },
  { sheet: "UNITS_DB", module: "Units", table: "units" },
  { sheet: "MASTER_ENTRY", module: "Bookings + Clients", table: "bookings, clients" },
  { sheet: "PAYMENTS", module: "Payments", table: "payments" },
  { sheet: "INSTALLMENT_LEDGER", module: "Installment Ledger", table: "installment_ledger" },
  { sheet: "LOSS IN ADJUSTEMENT", module: "Adjustments", table: "adjustments" },
  { sheet: "SETTINGS", module: "Settings & dropdown lists", table: "app_settings" },
  { sheet: "DOCUMENT_CENTER", module: "Document templates", table: "documents (templates)" },
  { sheet: "REPORTS", module: "Reports", table: "(computed on the fly)" },
];

export default function ImportCenter() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <div>
      <PageHeader title="Import Center" description="Map an Excel workbook to the ERP database. The initial seed is already loaded from your audited workbook." />
      <div className="card-elevated p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-accent text-accent-foreground grid place-items-center"><FileSpreadsheet className="h-5 w-5" /></div>
          <div className="flex-1">
            <div className="font-semibold">Upload .xlsm / .xlsx</div>
            <div className="text-xs text-muted-foreground">Parsing happens client-side. Full reconciliation runs after preview.</div>
          </div>
          <label className="inline-flex">
            <input type="file" accept=".xlsm,.xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button asChild><span><Upload className="h-4 w-4 mr-1" /> Choose file</span></Button>
          </label>
        </div>
        {file && (
          <div className="mt-4 flex items-center justify-between text-sm bg-muted/40 rounded-lg p-3">
            <div><span className="font-medium">{file.name}</span> · {(file.size / 1024).toFixed(0)} KB</div>
            <Button size="sm" variant="outline" disabled>Validate &amp; preview (coming soon)</Button>
          </div>
        )}
      </div>

      <div className="card-elevated overflow-hidden">
        <div className="p-4 border-b">
          <div className="text-sm font-semibold">Workbook → App mapping</div>
          <div className="text-xs text-muted-foreground">Source-of-truth references parsed from the SCHEMA_MAP sheet</div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Workbook Sheet</th>
              <th className="text-left px-4 py-2 font-medium">App Module</th>
              <th className="text-left px-4 py-2 font-medium">Database Table</th>
              <th className="text-right px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sheetMap.map((m) => (
              <tr key={m.sheet} className="border-t">
                <td className="px-4 py-2 font-mono text-xs">{m.sheet}</td>
                <td className="px-4 py-2">{m.module} <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" /></td>
                <td className="px-4 py-2 font-mono text-xs text-primary">{m.table}</td>
                <td className="px-4 py-2 text-right">
                  <span className="badge-pill bg-success/10 text-success border border-success/20">
                    <CheckCircle2 className="h-3 w-3" /> Seeded
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 card-elevated p-5 flex items-start gap-3 bg-warning/5 border-warning/20">
        <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-semibold">Re-import order</div>
          <div className="text-muted-foreground text-xs mt-1">Settings → Projects → Units → Clients → Bookings → Adjustments → Payments → Regenerate Installments → Regenerate Ledger → Validate Totals.</div>
        </div>
      </div>
    </div>
  );
}
