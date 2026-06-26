import letterheadAsset from "@/assets/precise-letterhead.jpg.asset.json";

export const LETTERHEAD_URL = letterheadAsset.url;

/**
 * Open a print window with the company letterhead as A4 background and
 * the given plain-text body rendered inside the safe content area.
 * The browser print dialog opens automatically.
 */
export function printOnLetterhead(opts: {
  title: string;
  body: string;
  /** When true the body is rendered as raw HTML (used for tabular templates). */
  html?: boolean;
}) {
  const { title, body, html = false } = opts;
  const origin = window.location.origin;
  const lh = LETTERHEAD_URL.startsWith("http") ? LETTERHEAD_URL : origin + LETTERHEAD_URL;

  const win = window.open("", "_blank", "width=900,height=1100");
  if (!win) throw new Error("Pop-up blocked — please allow pop-ups to print.");

  const safe = html
    ? body
    : body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font-family: "Times New Roman", Georgia, serif; font-size: 11.5pt; line-height: 1.55; }
  .page {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background-image: url('${lh}');
    background-repeat: no-repeat;
    background-position: top center;
    background-size: 210mm 297mm;
    /* Safe area away from header / footer / side stripes */
    padding: 58mm 22mm 38mm 24mm;
    box-sizing: border-box;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }
  .doc-title {
    text-align: center;
    font-weight: 700;
    font-size: 14pt;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin: 0 0 14pt 0;
    text-decoration: underline;
  }
  .meta { display:flex; justify-content: space-between; font-size: 10.5pt; margin-bottom: 14pt; }
  pre.body {
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: inherit;
    font-size: inherit;
    line-height: 1.6;
    margin: 0;
  }
  table.tpl { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin: 6pt 0; }
  table.tpl th, table.tpl td { border: 0.6pt solid #555; padding: 4pt 6pt; text-align: left; }
  table.tpl th { background: #f0f0f0; }
  @media screen { body { background: #e5e7eb; padding: 12mm 0; } .page { box-shadow: 0 1px 12px rgba(0,0,0,.15); } }
  @media print { body { background: #fff; padding: 0; } .page { box-shadow: none; } }
</style></head><body>
<div class="page">${safe}</div>
<script>
  const img = new Image();
  img.onload = img.onerror = () => setTimeout(() => { window.focus(); window.print(); }, 150);
  img.src = ${JSON.stringify(lh)};
</script>
</body></html>`);
  win.document.close();
}
