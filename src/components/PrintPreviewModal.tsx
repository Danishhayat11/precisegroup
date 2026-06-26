import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { LETTERHEAD_URL } from "@/lib/print";

/**
 * A4 page geometry — keep in sync with src/lib/print.ts.
 * Safe area = page minus the letterhead's header/footer bands.
 */
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const PAD_TOP_MM = 58;
const PAD_RIGHT_MM = 22;
const PAD_BOTTOM_MM = 38;
const PAD_LEFT_MM = 24;
const CONTENT_W_MM = PAGE_W_MM - PAD_LEFT_MM - PAD_RIGHT_MM; // 164
const CONTENT_H_MM = PAGE_H_MM - PAD_TOP_MM - PAD_BOTTOM_MM; // 201

const MM_TO_PX = 96 / 25.4; // CSS px per mm at 96dpi (matches mm units in CSS)
const CONTENT_H_PX = CONTENT_H_MM * MM_TO_PX;

const PRINT_FONT =
  '"Times New Roman", Georgia, serif';

type TextMode = { mode: "text"; body: string };
type ReactMode = { mode: "react"; children: ReactNode };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
} & (TextMode | ReactMode);

/* ------------------------------------------------------------------ */
/* Pagination helpers                                                  */
/* ------------------------------------------------------------------ */

function paginateText(lines: string[]): string[][] {
  // Render each line inside a measurement div sized to the safe content width,
  // accumulate heights and split into pages of <= CONTENT_H_PX.
  const measurer = document.createElement("div");
  measurer.style.cssText = `
    position: fixed; left: -10000px; top: 0;
    width: ${CONTENT_W_MM}mm;
    font-family: ${PRINT_FONT};
    font-size: 11.5pt; line-height: 1.55;
    white-space: pre-wrap; word-wrap: break-word;
    visibility: hidden;
  `;
  document.body.appendChild(measurer);

  const pages: string[][] = [[]];
  let pageH = 0;
  for (const raw of lines) {
    const probe = document.createElement("div");
    // Preserve blank lines with a non-collapsing space.
    probe.textContent = raw.length ? raw : "\u00A0";
    measurer.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    if (pageH + h > CONTENT_H_PX && pages[pages.length - 1].length > 0) {
      pages.push([raw]);
      pageH = h;
    } else {
      pages[pages.length - 1].push(raw);
      pageH += h;
    }
  }
  document.body.removeChild(measurer);
  return pages;
}

/* ------------------------------------------------------------------ */
/* React-mode measurement: render once hidden, slice children into pages */
/* ------------------------------------------------------------------ */

function useReactPages(children: ReactNode): { pages: number[][]; measureRef: (el: HTMLDivElement | null) => void } {
  const [pages, setPages] = useState<number[][]>([[0]]);
  const measureEl = useRef<HTMLDivElement | null>(null);

  const measureRef = (el: HTMLDivElement | null) => {
    measureEl.current = el;
  };

  useLayoutEffect(() => {
    const el = measureEl.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    const out: number[][] = [[]];
    let h = 0;
    kids.forEach((k, i) => {
      const kh = k.getBoundingClientRect().height;
      if (h + kh > CONTENT_H_PX && out[out.length - 1].length > 0) {
        out.push([i]);
        h = kh;
      } else {
        out[out.length - 1].push(i);
        h += kh;
      }
    });
    setPages(out.length ? out : [[0]]);
    // re-measure if images/fonts load
    const imgs = el.querySelectorAll("img");
    if (imgs.length) {
      const handlers: Array<() => void> = [];
      imgs.forEach((img) => {
        if (!(img as HTMLImageElement).complete) {
          const fn = () => measureRef(el);
          img.addEventListener("load", fn, { once: true });
          handlers.push(() => img.removeEventListener("load", fn));
        }
      });
      return () => handlers.forEach((h) => h());
    }
  }, [children]);

  return { pages, measureRef };
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export default function PrintPreviewModal(props: Props) {
  const { open, onOpenChange, title } = props;
  const [zoom, setZoom] = useState(0.75);

  // Text mode pagination
  const textPages = useMemo(() => {
    if (props.mode !== "text" || !open) return null;
    return paginateText(props.body.split("\n"));
  }, [props, open]);

  // React mode pagination
  const isReact = props.mode === "react";
  const { pages: reactPageGroups, measureRef } = useReactPages(isReact ? (props as ReactMode).children : null);
  const reactChildren = isReact ? (props as ReactMode).children : null;

  const pageCount = textPages ? textPages.length : reactPageGroups.length;

  const handlePrint = () => {
    const style = document.createElement("style");
    style.id = "pp-print-style";
    style.textContent = `
      @page { size: A4; margin: 0; }
      @media print {
        body * { visibility: hidden !important; }
        .pp-print-root, .pp-print-root * { visibility: visible !important; }
        .pp-print-root { position: absolute; left: 0; top: 0; margin: 0 !important; padding: 0 !important; background: #fff !important; }
        .pp-sheet { box-shadow: none !important; margin: 0 !important; transform: none !important; page-break-after: always; break-after: page; }
        .pp-sheet:last-child { page-break-after: auto; break-after: auto; }
        .pp-zoom-wrap { transform: none !important; }
      }
    `;
    document.head.appendChild(style);
    const cleanup = () => {
      document.getElementById("pp-print-style")?.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => window.print(), 50);
  };

  const sheetStyle: React.CSSProperties = {
    width: `${PAGE_W_MM}mm`,
    height: `${PAGE_H_MM}mm`,
    backgroundImage: `url('${LETTERHEAD_URL}')`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "top center",
    backgroundSize: `${PAGE_W_MM}mm ${PAGE_H_MM}mm`,
    padding: `${PAD_TOP_MM}mm ${PAD_RIGHT_MM}mm ${PAD_BOTTOM_MM}mm ${PAD_LEFT_MM}mm`,
    boxSizing: "border-box",
    background: "#fff",
    color: "#111",
    fontFamily: PRINT_FONT,
    fontSize: "11.5pt",
    lineHeight: 1.55,
    overflow: "hidden",
  };

  // Hidden measuring container for react mode
  const measureNode =
    isReact && open
      ? createPortal(
          <div
            ref={measureRef}
            style={{
              position: "fixed",
              left: "-10000px",
              top: 0,
              width: `${CONTENT_W_MM}mm`,
              fontFamily: PRINT_FONT,
              fontSize: "11.5pt",
              lineHeight: 1.55,
              visibility: "hidden",
            }}
          >
            {reactChildren}
          </div>,
          document.body
        )
      : null;

  // Flatten react children into a stable array we can slice by index
  const reactChildArray = useMemo(() => {
    if (!isReact) return [] as ReactNode[];
    const arr: ReactNode[] = [];
    const walk = (n: ReactNode) => {
      if (Array.isArray(n)) n.forEach(walk);
      else arr.push(n);
    };
    walk(reactChildren);
    return arr;
  }, [isReact, reactChildren]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(96vw,1100px)] w-[min(96vw,1100px)] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b bg-card">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-sm font-semibold truncate">{title}</div>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {pageCount} page{pageCount === 1 ? "" : "s"} · A4
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <div className="text-[11px] tabular-nums w-10 text-center text-muted-foreground">{Math.round(zoom * 100)}%</div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom(1)} title="100%">
              <Maximize2 className="h-4 w-4" />
            </Button>
            <div className="w-px h-5 bg-border mx-1" />
            <Button size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)} title="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Preview canvas */}
        <div className="flex-1 overflow-auto bg-[hsl(var(--muted))] p-6">
          {measureNode}
          <div
            className="pp-print-root mx-auto"
            style={{ width: `${PAGE_W_MM * zoom}mm` }}
          >
            <div
              className="pp-zoom-wrap"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                width: `${PAGE_W_MM}mm`,
              }}
            >
              {textPages?.map((lines, i) => (
                <div
                  key={i}
                  className="pp-sheet shadow-[0_2px_18px_rgba(0,0,0,0.15)] mb-6"
                  style={sheetStyle}
                >
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordWrap: "break-word",
                      fontFamily: "inherit",
                      fontSize: "inherit",
                      lineHeight: 1.55,
                    }}
                  >
                    {lines.join("\n")}
                  </pre>
                </div>
              ))}

              {isReact &&
                reactPageGroups.map((indices, i) => (
                  <div
                    key={i}
                    className="pp-sheet shadow-[0_2px_18px_rgba(0,0,0,0.15)] mb-6"
                    style={sheetStyle}
                  >
                    {indices.map((idx) => (
                      <div key={idx}>{reactChildArray[idx]}</div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
