import { format, parseISO, isValid } from "date-fns";

export const fmtPKR = (n: number | null | undefined, opts?: { decimals?: number }) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-PK", {
    maximumFractionDigits: opts?.decimals ?? 0,
    minimumFractionDigits: 0,
  });
};

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? parseISO(d) : d;
  return isValid(date) ? format(date, "dd-MMM-yyyy") : "—";
};

export const maskCNIC = (cnic?: string | null) => {
  if (!cnic) return "—";
  return cnic.replace(/^(\d{5})-?(\d{7})-?(\d)$/, "$1-•••••••-$3");
};

export const compact = (n: number) => {
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + " L";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toString();
};
