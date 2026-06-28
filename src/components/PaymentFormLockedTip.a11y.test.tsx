import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  LockedTip,
  LOCKED_FIELDS,
} from "@/components/PaymentFormLockedTip";

/**
 * Accessibility integration tests for the locked-field tooltips that
 * PaymentForm renders. Verifies — for EVERY field in LOCKED_FIELDS — that
 * the Radix-backed Tooltip satisfies the ARIA tooltip pattern:
 *
 *   • trigger exposes `aria-describedby` pointing at the tooltip content
 *     (this is the WAI-ARIA "tooltip" pattern; screen readers announce
 *     the tooltip text the moment focus lands on the trigger, so a
 *     separate aria-live region is intentionally NOT used — Radix's
 *     describedby wiring is the canonical accessible-name source);
 *   • the tooltip content carries `role="tooltip"` so AT can locate it;
 *   • keyboard focus on the trigger opens the tooltip (no mouse needed);
 *   • blurring the trigger dismisses it;
 *   • pressing Escape while focused dismisses it (per the ARIA pattern).
 */

const BLOCKED = {
  failedCondition: "adjustment_cash_invariant",
  liveBlockStatus: {
    stillFails: true,
    reason: "safe_cash_amount (250000) ≠ 0 for Adjustment/Asset",
  },
};

function renderField(field: string, note: string) {
  return render(
    <TooltipProvider delayDuration={0}>
      <LockedTip
        locked
        failedCondition={BLOCKED.failedCondition}
        liveBlockStatus={BLOCKED.liveBlockStatus}
        field={field}
        note={note}
      >
        <button data-testid="locked-target">{field} control</button>
      </LockedTip>
    </TooltipProvider>,
  );
}

/** The Radix TooltipTrigger is the wrapping span (asChild + child <span>). */
function getTrigger(): HTMLElement {
  return screen.getByTestId("locked-target").parentElement!;
}

afterEach(() => cleanup());

describe("LockedTip accessibility — ARIA tooltip pattern for every LOCKED_FIELD", () => {
  it.each(LOCKED_FIELDS)(
    "[%s] focus opens tooltip, aria-describedby is wired, blur + Escape dismiss it",
    async ({ field, note }) => {
      renderField(field, note);

      const trigger = getTrigger();

      // 1. Closed by default → no role=tooltip, no aria-describedby on the trigger.
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      expect(trigger.getAttribute("aria-describedby")).toBeNull();

      // 2. Keyboard focus opens the tooltip (no pointer events needed).
      fireEvent.focus(trigger);
      const tip = await screen.findByRole("tooltip");

      // 3. Tooltip content has an id and the trigger's aria-describedby
      //    points at it — this is what AT uses to announce the tooltip.
      const describedBy = trigger.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(tip.id).toBe(describedBy);

      // 4. The described-by content includes the field-specific copy a
      //    screen reader will read out: the locked header, the failed
      //    condition tag, the per-field note, and the unlock action.
      const u = within(tip);
      expect(u.getByText(new RegExp(`${field} is locked`, "i"))).toBeInTheDocument();
      expect(u.getByText(BLOCKED.failedCondition)).toBeInTheDocument();
      expect(u.getByText(note)).toBeInTheDocument();
      expect(u.getByText(/to unlock:/i)).toBeInTheDocument();

      // 5. Blurring the trigger dismisses the tooltip (Radix default).
      fireEvent.blur(trigger);
      await waitFor(() =>
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
      );
      expect(trigger.getAttribute("aria-describedby")).toBeNull();

      // 6. Re-open, then dismiss with Escape — required by the ARIA
      //    tooltip pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tooltip).
      fireEvent.focus(trigger);
      await screen.findByRole("tooltip");
      fireEvent.keyDown(trigger, { key: "Escape", code: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
      );
    },
  );

  it("does not wire aria-describedby when the field is unlocked (no tooltip to announce)", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <LockedTip
          locked={false}
          failedCondition={BLOCKED.failedCondition}
          liveBlockStatus={BLOCKED.liveBlockStatus}
          field="Payment Date"
          note={LOCKED_FIELDS[0].note}
        >
          <button data-testid="locked-target">Payment Date</button>
        </LockedTip>
      </TooltipProvider>,
    );
    const target = screen.getByTestId("locked-target");
    // No wrapping trigger span when unlocked — children render raw.
    expect(target.parentElement?.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps the tooltip trigger reachable by keyboard (focusable, not aria-hidden)", () => {
    renderField("Notes", LOCKED_FIELDS.find((f) => f.field === "Notes")!.note);
    const trigger = getTrigger();
    // The trigger must not hide itself from AT or remove its child from the
    // tab order — otherwise keyboard users can't surface the lock reason.
    expect(trigger.getAttribute("aria-hidden")).not.toBe("true");
    const child = screen.getByTestId("locked-target");
    expect(child.getAttribute("tabindex")).not.toBe("-1");
  });
});
