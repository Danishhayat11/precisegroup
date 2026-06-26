import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

export function OverdueAlertBar() {
  const { data } = useQuery({
    queryKey: ["overdue-alert-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("booking_id,current_overdue_count")
        .gt("current_overdue_count", 0);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const count = data?.length ?? 0;
  if (!count) return null;

  return (
    <Link
      to="/bookings"
      className="block bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium hover:bg-destructive/90 transition-colors"
    >
      <div className="max-w-[1600px] mx-auto flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          <strong>{count}</strong> client{count === 1 ? "" : "s"} {count === 1 ? "has" : "have"} overdue installments —
          click to review
        </span>
      </div>
    </Link>
  );
}
