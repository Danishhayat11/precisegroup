import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { FileText, Receipt, Home, Scroll, FileCheck2, Files, Briefcase, ClipboardCheck, FileSignature, Truck, AlertOctagon } from "lucide-react";

const docs = [
  { key: "receipt", label: "Payment Receipt", icon: Receipt, desc: "Issue a printable receipt against any payment" },
  { key: "payment-plan", label: "Payment Plan", icon: FileText, desc: "Full installment schedule for a booking" },
  { key: "allotment", label: "Allotment Letter", icon: Home, desc: "Confirm unit allotment to client" },
  { key: "possession", label: "Possession Letter", icon: FileCheck2, desc: "Hand-over of possession" },
  { key: "prov-possession", label: "Provisional Possession", icon: FileCheck2, desc: "Conditional possession before final clearance" },
  { key: "legal-notice", label: "Legal Notice", icon: AlertOctagon, desc: "Notice for default / breach" },
  { key: "deposit-summary", label: "Deposit Summary", icon: ClipboardCheck, desc: "Statement of deposits received" },
  { key: "transfer-form", label: "Transfer Form", icon: Files, desc: "Initiate unit transfer" },
  { key: "sale-agreement", label: "Sale Agreement", icon: FileSignature, desc: "Formal sale agreement" },
  { key: "transfer-checklist", label: "Transfer Checklist", icon: ClipboardCheck, desc: "Required documents for transfer" },
  { key: "affidavit", label: "Affidavit of Transfer", icon: Scroll, desc: "Affidavit accompanying transfer" },
  { key: "transfer-letter", label: "Transfer Letter", icon: Truck, desc: "Confirm completion of transfer" },
];

export default function Documents() {
  return (
    <div>
      <PageHeader title="Document Center" description="A4 print-ready templates auto-filled from booking data" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {docs.map((d) => (
          <Link key={d.key} to={`/documents/${d.key}`} className="kpi-tile group block">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-accent text-accent-foreground grid place-items-center">
                <d.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium group-hover:text-primary transition-colors">{d.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{d.desc}</div>
              </div>
              <Briefcase className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
