import { ReactNode, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  sortValue?: (row: T) => string | number;
}

export function DataTable<T extends { [k: string]: any }>({
  rows, columns, searchKeys, empty, rowKey, rowHref,
}: {
  rows: T[];
  columns: Column<T>[];
  searchKeys?: (keyof T)[];
  empty?: ReactNode;
  rowKey: (r: T) => string;
  rowHref?: (r: T) => string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!q) return rows;
    const lq = q.toLowerCase();
    return rows.filter((r) =>
      (searchKeys ?? Object.keys(r)).some((k) => String(r[k as string] ?? "").toLowerCase().includes(lq))
    );
  }, [rows, q, searchKeys]);

  return (
    <div className="card-elevated overflow-hidden">
      <div className="p-3 border-b flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="pl-9 h-9 bg-muted/50 border-transparent" />
        </div>
        <div className="text-xs text-muted-foreground ml-auto">{filtered.length} of {rows.length}</div>
      </div>
      <div className="overflow-x-auto max-h-[68vh]">
        <table className="w-full text-sm table-sticky">
          <thead className="text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`px-4 py-2.5 font-medium border-b text-${c.align ?? "left"} ${c.className ?? ""}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={columns.length} className="text-center text-muted-foreground p-10">{empty ?? "No records."}</td></tr>
            ) : filtered.map((r) => (
              <tr key={rowKey(r)}
                  className={`border-t hover:bg-muted/30 transition-colors ${rowHref ? "cursor-pointer" : ""}`}
                  onClick={rowHref ? () => { window.location.href = rowHref(r); } : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-2.5 text-${c.align ?? "left"} ${c.className ?? ""}`}>{c.cell(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
