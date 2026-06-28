import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  LockedTip,
  LOCKED_FIELDS,
} from "@/components/PaymentFormLockedTip";

// Stable, deterministic props for the lock state. Mirrors what PaymentForm
// passes when the database trigger rejects a payload.
const BLOCKED = {
  failedCondition: "adjustment_cash_invariant",
  liveBlockStatus: { stillFails: true, reason: "safe_cash_amount (250000) ≠ 0 for Adjustment/Asset" },
};

function renderField(field: string, note: string, locked = true) {
  return render(
    <TooltipProvider delayDuration={0}>
      <LockedTip
        locked={locked}
        failedCondition={BLOCKED.failedCondition}
        liveBlockStatus={BLOCKED.liveBlockStatus}
        field={field}
        note={note}
      >
        <button data-testid="locked-target">{field} control</button>
      </LockedTip>
    </TooltipProvider>
  );
}

/**
 * Open the tooltip by focusing the trigger. The wrapper span is the
 * TooltipTrigger; focusing the child target bubbles focus to the trigger,
 * which Radix uses to show the tooltip content.
 */
async function openTooltip() {
  const trigger = screen.getByTestId("locked-target").parentElement!;
  fireEvent.focus(trigger);
  // Radix renders a TooltipContent role="tooltip" once shown.
  return await screen.findByRole("tooltip");
}

afterEach(() => cleanup());

describe("PaymentForm locked-field tooltips", () => {
  it("renders no tooltip wrapper when not locked", () => {
    renderField("Payment Date", LOCKED_FIELDS[0].note, false);
    expect(screen.getByTestId("locked-target")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // Drives one assertion per field the PaymentForm actually locks. Keeps
  // wording, failed-condition surfacing, and unlock guidance in lockstep
  // with the live UI.
  it.each(LOCKED_FIELDS)(
    "shows the unlock explanation for the %s field",
    async ({ field, note }) => {
      renderField(field, note);
      const tip = await openTooltip();
      const utils = within(tip);

      // 1. Header names this specific field.
      expect(utils.getByText(new RegExp(`${field} is locked`, "i"))).toBeInTheDocument();

      // 2. The exact failed_condition from the trigger is surfaced.
      expect(utils.getByText(BLOCKED.failedCondition)).toBeInTheDocument();
      expect(
        utils.getByText(/rejected by the database trigger/i)
      ).toBeInTheDocument();

      // 3. Per-field note explains why THIS control is frozen.
      expect(utils.getByText(note)).toBeInTheDocument();

      // 4. Unlock guidance always names the three toggles that clear the lock.
      const unlock = utils.getByText(/to unlock:/i).parentElement!;
      expect(unlock).toHaveTextContent(/Payment Type/);
      expect(unlock).toHaveTextContent(/Amount/);
      expect(unlock).toHaveTextContent(/Payment Head/);

      // 5. Live re-check failure reason is surfaced so the user knows the
      //    lock won't clear yet.
      expect(
        utils.getByText(/Live re-check still fails:.*safe_cash_amount/i)
      ).toBeInTheDocument();
    }
  );

  it("omits the live re-check line when the re-check passes", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <LockedTip
          locked
          failedCondition="adjustment_cash_invariant"
          liveBlockStatus={{ stillFails: false }}
          field="Notes"
          note="Notes are read-only while a blocked attempt is open so they stay in sync with the audited payload."
        >
          <button data-testid="locked-target">Notes control</button>
        </LockedTip>
      </TooltipProvider>
    );
    const tip = await openTooltip();
    expect(within(tip).queryByText(/live re-check still fails/i)).not.toBeInTheDocument();
  });

  it("falls back to 'cash invariant' when no failed_condition is provided", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <LockedTip
          locked
          failedCondition={null}
          liveBlockStatus={null}
          field="Payment Date"
          note="Date can't shift until the cash-invariant issue above is resolved."
        >
          <button data-testid="locked-target">Date</button>
        </LockedTip>
      </TooltipProvider>
    );
    const tip = await openTooltip();
    expect(within(tip).getByText("cash invariant")).toBeInTheDocument();
  });
});
