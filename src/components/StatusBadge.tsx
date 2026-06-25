import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "muted" | "adjustment";

const tones: Record<Tone, string> = {
  success: "bg-success/12 text-success border border-success/20",
  warning: "bg-warning/12 text-warning border border-warning/20",
  danger: "bg-destructive/12 text-destructive border border-destructive/25",
  info: "bg-primary/10 text-primary border border-primary/20",
  muted: "bg-muted text-muted-foreground border border-border",
  adjustment: "bg-adjustment/12 text-adjustment border border-adjustment/20",
};

export function StatusBadge({ label, tone = "muted" }: { label: string; tone?: Tone }) {
  return <span className={cn("badge-pill", tones[tone])}>{label}</span>;
}

export function statusTone(status?: string | null): Tone {
  const s = (status ?? "").toLowerCase();
  if (s.includes("paid") && !s.includes("partial")) return "success";
  if (s.includes("overdue") || s.includes("cancel") || s === "high") return "danger";
  if (s.includes("partial") || s.includes("warning") || s === "medium" || s.includes("due soon")) return "warning";
  if (s === "active" || s === "low" || s.includes("posted") || s === "available") return "success";
  if (s.includes("pending")) return "info";
  if (s.includes("booked") || s.includes("sold")) return "info";
  if (s.includes("adjust")) return "adjustment";
  return "muted";
}
