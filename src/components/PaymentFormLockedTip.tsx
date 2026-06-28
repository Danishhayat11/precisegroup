import { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface LockedTipLiveStatus {
  stillFails?: boolean;
  reason?: string;
}

export interface LockedTipProps {
  /** When false, children render unchanged (no tooltip wrapper). */
  locked: boolean;
  /** Trigger failed_condition that caused the lock. */
  failedCondition?: string | null;
  /** Live re-check status — if still failing, the reason is surfaced. */
  liveBlockStatus?: LockedTipLiveStatus | null;
  /** Human-friendly field label rendered in the tooltip header. */
  field: string;
  /** Optional per-field note explaining why this specific control is frozen. */
  note?: string;
  children: ReactNode;
}

/**
 * Inline tooltip wrapper for fields that are frozen after a Postgres trigger
 * rejected a payment save. Explains exactly which invariant failed and which
 * three controls (Payment Type / Amount / Payment Head) unlock the form.
 *
 * Extracted from PaymentForm so the tooltip wording can be exercised in
 * isolation by integration tests for each call site.
 */
export function LockedTip({
  locked,
  failedCondition,
  liveBlockStatus,
  field,
  note,
  children,
}: LockedTipProps) {
  if (!locked) return <>{children}</>;
  const cond = failedCondition ?? "cash invariant";
  const stillFails = liveBlockStatus?.stillFails;
  const liveReason = liveBlockStatus?.reason;
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span className="block">{children}</span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-[300px] text-[11px] leading-snug"
      >
        <p className="font-semibold text-destructive">🔒 {field} is locked</p>
        <p className="mt-1">
          The last save was rejected by the database trigger
          (<code className="font-mono text-[10px]">{cond}</code>), so this field
          is frozen to prevent re-submitting the same row.
        </p>
        {note && <p className="mt-1 text-muted-foreground">{note}</p>}
        <p className="mt-1">
          <span className="font-semibold">To unlock:</span> change{" "}
          <span className="font-semibold">Payment Type</span>,{" "}
          <span className="font-semibold">Amount</span>, or{" "}
          <span className="font-semibold">Payment Head</span> above — the
          failed-condition check re-runs on each edit and clears the lock the
          moment it passes.
        </p>
        {stillFails && liveReason && (
          <p className="mt-1 text-destructive">
            ↳ Live re-check still fails: {liveReason}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Field config used by PaymentForm. Exported so integration tests can iterate
 * over every locked field and assert each tooltip explains its specific
 * unlock condition.
 */
export const LOCKED_FIELDS: { field: string; note: string }[] = [
  {
    field: "Payment Date",
    note: "Date can't shift until the cash-invariant issue above is resolved.",
  },
  {
    field: "Booking",
    note: "Re-pointing to a different booking while a blocked attempt is open could orphan the audit row. Clear the block first.",
  },
  {
    field: "Bank Name",
    note: "Bank/account changes are blocked while the trigger rejection stands — the row itself can't be saved yet.",
  },
  {
    field: "Cheque / Reference Number",
    note: "Reference data is frozen so you don't tweak it while the same invariant-violating row is sitting in the form.",
  },
  {
    field: "Received By",
    note: "Receiver name is locked together with the rest of the metadata until the cash-invariant block clears.",
  },
  {
    field: "Notes",
    note: "Notes are read-only while a blocked attempt is open so they stay in sync with the audited payload.",
  },
  {
    field: "Save",
    note: "Save is disabled because the database trigger already rejected this exact payload. Re-submitting it would only produce another blocked audit row.",
  },
];
