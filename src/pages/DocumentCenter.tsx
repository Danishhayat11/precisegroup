import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { BookingSelector, type BookingSummary } from "@/components/BookingSelector";
import { Card } from "@/components/ui/card";
import { FileText } from "lucide-react";

/**
 * Section B host page — Document Center.
 *
 * For now this only wires the booking selector + summary card. The 9-doc
 * generator menu, auto-fill engine and preview/print panels are added in
 * subsequent sections (C / E / F).
 */
export default function DocumentCenter() {
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingSummary | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Document Center"
        description="Generate Agreement, Allotment, Possession, Receipt and other client-facing documents."
      />

      <BookingSelector
        value={bookingId}
        onChange={(id, b) => {
          setBookingId(id);
          setBooking(b);
        }}
      />

      {booking && (
        <Card className="p-6 border-dashed text-sm text-muted-foreground flex items-center gap-3">
          <FileText className="h-5 w-5" />
          Document menu (Agreement, Allotment, Payment Plan, Receipt, …) will
          appear here once Section C is wired up.
        </Card>
      )}
    </div>
  );
}
