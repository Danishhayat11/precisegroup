import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { BookingSelector, type BookingSummary } from "@/components/BookingSelector";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Printer } from "lucide-react";

type DocItem = {
  n: number;
  name: string;
  desc: string;
  enabled: boolean;
  to?: (bookingId: string) => string;
};

const DOC_LIST: DocItem[] = [
  { n: 1, name: "Agreement to Sell", desc: "Coming soon", enabled: false },
  { n: 2, name: "Payment Plan", desc: "Coming soon", enabled: false },
  { n: 3, name: "Payment History", desc: "Client statement of all payments received", enabled: true, to: (id) => `/payment-history/${id}` },
  { n: 4, name: "Allotment Letter", desc: "Coming soon", enabled: false },
  { n: 5, name: "Possession Letter", desc: "Coming soon", enabled: false },
  { n: 6, name: "Receipt", desc: "Coming soon", enabled: false },
  { n: 7, name: "Notice", desc: "Coming soon", enabled: false },
  { n: 8, name: "Transfer Letter", desc: "Coming soon", enabled: false },
  { n: 9, name: "Cancellation Letter", desc: "Coming soon", enabled: false },
];

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

      {booking && bookingId && (
        <Card className="p-4">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4" /> Documents for {booking.booking_id}
          </div>
          <div className="divide-y">
            {DOC_LIST.map((d) => (
              <div key={d.n} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                    {d.n}
                  </span>
                  <div className="min-w-0">
                    <div className={`text-sm font-medium ${d.enabled ? "" : "text-muted-foreground"}`}>{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.desc}</div>
                  </div>
                </div>
                {d.enabled && d.to ? (
                  <Button asChild size="sm" variant="outline">
                    <Link to={d.to(bookingId)}>
                      <Printer className="h-4 w-4 mr-1" /> Open
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>Soon</Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
