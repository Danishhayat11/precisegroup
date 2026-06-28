import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftToLine, Loader2 } from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  receiptNo: string;
  auditId: string;
}

/**
 * "Back to payment" link in the Audit Log. Shows a tooltip explaining what
 * happens on click, and a loading spinner + "Opening Payment form…" label
 * while the Payments route mounts and prefills the form — so the user gets
 * immediate feedback that the click was registered.
 */
export function AuditBackToPaymentLink({ receiptNo, auditId }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const href = `/payments?openReceipt=${encodeURIComponent(receiptNo)}&audit=${encodeURIComponent(auditId)}`;

  const go = (e: React.MouseEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    // Give React a tick to paint the loading state before navigation.
    setTimeout(() => navigate(href), 0);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={href}
            onClick={go}
            aria-busy={loading}
            aria-disabled={loading}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold transition-colors",
              loading
                ? "border-destructive/40 bg-destructive/15 text-destructive cursor-wait"
                : "border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10",
            )}
          >
            {loading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Opening Payment form…
              </>
            ) : (
              <>
                <ArrowLeftToLine className="h-3 w-3" />
                Back to payment
              </>
            )}
          </a>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-xs leading-snug">
          <div className="font-semibold">Back to Payment form</div>
          <div className="text-muted-foreground mt-0.5">
            Opens <span className="font-mono">{receiptNo}</span> with this exact
            blocked attempt prefilled and pops the audit drawer pre-loaded with
            this entry. The URL keeps the params so a browser refresh re-prefills
            the same way.
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
