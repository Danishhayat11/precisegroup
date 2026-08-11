import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Upload,
  Trash2,
  Download,
  Eye,
  Search,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  BookingDocument,
  LABEL_OPTIONS,
  MANDATORY_LABELS,
  MAX_BYTES,
  ALLOWED_MIME,
  NOTICE_LABELS,
  SENT_VIA_OPTIONS,
  type SentVia,
  deleteDoc,
  downloadDoc,
  fileKind,
  fmtSize,
  listDocs,
  signedUrl,
  uploadDoc,
} from "@/lib/bookingDocuments";

function KindIcon({ mime }: { mime?: string | null }) {
  const k = fileKind(mime);
  if (k === "pdf") return <FileText className="h-4 w-4 text-destructive" />;
  if (k === "word") return <FileText className="h-4 w-4 text-primary" />;
  if (k === "image") return <ImageIcon className="h-4 w-4 text-success" />;
  return <FileIcon className="h-4 w-4 text-muted-foreground" />;
}

interface Props {
  bookingId: string;
}

export default function DocumentVault({ bookingId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [label, setLabel] = useState<string>(LABEL_OPTIONS[0]);
  const [labelCustom, setLabelCustom] = useState("");
  const [docDate, setDocDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [sentVia, setSentVia] = useState<SentVia | "">("");
  const [tcsTracking, setTcsTracking] = useState("");
  const [whatsappTo, setWhatsappTo] = useState("");
  const [uploading, setUploading] = useState(false);

  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<string>("All");

  const [toDelete, setToDelete] = useState<BookingDocument | null>(null);
  const [previewDoc, setPreviewDoc] = useState<BookingDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["booking-documents", bookingId],
    queryFn: () => listDocs(bookingId),
    enabled: !!bookingId,
  });

  const hasAgreement = useMemo(
    () => docs.some((d) => d.label === "Agreement to Sell / Booking Form"),
    [docs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (labelFilter !== "All" && d.label !== labelFilter) return false;
      if (!q) return true;
      const hay = [d.label, d.label_custom, d.file_name, d.notes, d.uploaded_by_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [docs, search, labelFilter]);

  function openPicker() {
    fileInputRef.current?.click();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: `Max size is 10MB. ${f.name} is ${fmtSize(f.size)}.`,
      });
      return;
    }
    if (f.type && !ALLOWED_MIME.includes(f.type)) {
      toast({
        variant: "destructive",
        title: "Unsupported file type",
        description: "Allowed: PDF, JPG, PNG, DOCX.",
      });
      return;
    }
    setPendingFile(f);
    setLabel(LABEL_OPTIONS[0]);
    setLabelCustom("");
    setDocDate(format(new Date(), "yyyy-MM-dd"));
    setNotes("");
    setSentVia("");
    setTcsTracking("");
    setWhatsappTo("");
  }

  const isNoticeLabel = NOTICE_LABELS.has(label);

  async function confirmUpload() {
    if (!pendingFile) return;
    if (label === "Other" && !labelCustom.trim()) {
      toast({ variant: "destructive", title: "Custom label required" });
      return;
    }
    if (isNoticeLabel && !sentVia) {
      toast({ variant: "destructive", title: "Select how this notice was sent" });
      return;
    }
    setUploading(true);
    try {
      await uploadDoc({
        bookingId,
        file: pendingFile,
        label,
        labelCustom: labelCustom.trim() || undefined,
        documentDate: docDate,
        notes: notes.trim() || undefined,
        sentVia: isNoticeLabel ? (sentVia as SentVia) : null,
        tcsTrackingNo:
          isNoticeLabel && (sentVia === "TCS Courier" || sentVia === "Both")
            ? tcsTracking.trim() || undefined
            : undefined,
        whatsappSentTo:
          isNoticeLabel && (sentVia === "WhatsApp" || sentVia === "Both")
            ? whatsappTo.trim() || null
            : null,
      });
      toast({ title: "Document uploaded", description: pendingFile.name });
      setPendingFile(null);
      qc.invalidateQueries({ queryKey: ["booking-documents", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-document-summaries"] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ variant: "destructive", title: "Upload failed", description: message });
    } finally {
      setUploading(false);
    }
  }


  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await deleteDoc(toDelete);
      toast({ title: "Document deleted" });
      qc.invalidateQueries({ queryKey: ["booking-documents", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-document-summaries"] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ variant: "destructive", title: "Delete failed", description: message });
    } finally {
      setToDelete(null);
    }
  }

  async function openPreview(d: BookingDocument) {
    if (!d.storage_path) {
      toast({ title: "No file attached", description: "This is a metadata-only entry." });
      return;
    }
    const k = fileKind(d.mime_type);
    if (k !== "pdf" && k !== "image") {
      // Word docs: just download
      downloadDoc(d).catch((err) =>
        toast({ variant: "destructive", title: "Download failed", description: err.message })
      );
      return;
    }
    try {
      const url = await signedUrl(d.storage_path, 300);
      setPreviewUrl(url);
      setPreviewDoc(d);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Preview failed", description: err.message });
    }
  }

  return (
    <div className="card-elevated overflow-hidden">
      <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Document Vault</div>
          <div className="text-xs text-muted-foreground">
            {docs.length} document{docs.length === 1 ? "" : "s"} on file
            {!hasAgreement && (
              <span className="ml-2 text-destructive font-medium">
                · Agreement to Sell missing
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={openPicker}>
            <Upload className="h-4 w-4 mr-1" /> Upload document
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.docx,.doc,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={onPick}
          />
        </div>
      </div>

      <div className="p-3 border-b flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search label, file, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Select value={labelFilter} onValueChange={setLabelFilter}>
          <SelectTrigger className="h-8 w-[240px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All labels</SelectItem>
            {LABEL_OPTIONS.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-[11px] text-muted-foreground ml-auto tabular-nums">
          {filtered.length} of {docs.length}
        </div>
      </div>

      <div className="overflow-x-auto max-h-[60vh]">
        <table className="w-full text-sm table-sticky">
          <thead className="text-xs text-muted-foreground bg-card">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Label</th>
              <th className="text-left px-3 py-2 font-medium">File</th>
              <th className="text-right px-3 py-2 font-medium">Size</th>
              <th className="text-left px-3 py-2 font-medium">Date</th>
              <th className="text-left px-3 py-2 font-medium">Sent Via</th>
              <th className="text-left px-3 py-2 font-medium">Uploaded By</th>
              <th className="text-left px-3 py-2 font-medium">Notes</th>
              <th className="text-right px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="text-center text-muted-foreground p-8">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-muted-foreground p-10">
                  No documents yet. Click "Upload document" to add the first one.
                </td>
              </tr>
            ) : (
              filtered.map((d) => (
                <tr key={d.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {d.label === "Other" ? d.label_custom || "Other" : d.label}
                    </div>
                    {d.source !== "manual" && (
                      <Badge variant="outline" className="mt-0.5 text-[10px]">
                        {d.source}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <KindIcon mime={d.mime_type} />
                      <span className="truncate max-w-[260px]" title={d.file_name ?? ""}>
                        {d.file_name ?? <span className="text-muted-foreground italic">metadata only</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                    {fmtSize(d.size_bytes)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {format(new Date(d.document_date), "dd-MMM-yyyy")}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {d.sent_via ? (
                      <div className="flex flex-col">
                        <span className="font-medium">{d.sent_via}</span>
                        {d.tcs_tracking_no && (
                          <span className="text-[10px] text-muted-foreground font-mono">TCS: {d.tcs_tracking_no}</span>
                        )}
                        {d.whatsapp_sent_to && (
                          <span className="text-[10px] text-muted-foreground">WA: {d.whatsapp_sent_to}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{d.uploaded_by_name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[220px] truncate" title={d.notes ?? ""}>
                    {d.notes ?? "—"}
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Preview"
                        disabled={!d.storage_path}
                        onClick={() => openPreview(d)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Download"
                        disabled={!d.storage_path}
                        onClick={() =>
                          downloadDoc(d).catch((err) =>
                            toast({ variant: "destructive", title: "Download failed", description: err.message })
                          )
                        }
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Delete"
                        onClick={() => setToDelete(d)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Upload metadata dialog */}
      <Dialog open={!!pendingFile} onOpenChange={(o) => !o && !uploading && setPendingFile(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add document details</DialogTitle>
            <DialogDescription className="truncate">
              {pendingFile?.name} · {fmtSize(pendingFile?.size)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Document Label *</Label>
              <Select value={label} onValueChange={setLabel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LABEL_OPTIONS.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {MANDATORY_LABELS.includes(label) && (
                <p className="text-[11px] text-muted-foreground mt-1">Mandatory document type.</p>
              )}
            </div>
            {label === "Other" && (
              <div>
                <Label className="text-xs">Custom label *</Label>
                <Input
                  value={labelCustom}
                  onChange={(e) => setLabelCustom(e.target.value)}
                  placeholder="Describe the document"
                />
              </div>
            )}
            {isNoticeLabel && (
              <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2.5">
                <div className="text-[11px] font-semibold text-foreground">
                  Delivery details
                  <span className="ml-1 text-muted-foreground font-normal">
                    (required for notice/letter records)
                  </span>
                </div>
                <div>
                  <Label className="text-xs">Sent Via *</Label>
                  <Select value={sentVia} onValueChange={(v) => setSentVia(v as SentVia)}>
                    <SelectTrigger><SelectValue placeholder="Select delivery method" /></SelectTrigger>
                    <SelectContent>
                      {SENT_VIA_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(sentVia === "TCS Courier" || sentVia === "Both") && (
                  <div>
                    <Label className="text-xs">TCS Tracking No.</Label>
                    <Input
                      value={tcsTracking}
                      onChange={(e) => setTcsTracking(e.target.value)}
                      placeholder="e.g. 1234567890"
                    />
                  </div>
                )}
                {(sentVia === "WhatsApp" || sentVia === "Both") && (
                  <div>
                    <Label className="text-xs">WhatsApp sent to</Label>
                    <Input
                      value={whatsappTo}
                      onChange={(e) => setWhatsappTo(e.target.value)}
                      placeholder="e.g. +92 333 1234567"
                    />
                  </div>
                )}
              </div>
            )}
            <div>
              <Label className="text-xs">Date of Document *</Label>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
              {isNoticeLabel && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Use this as the date the notice was sent.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingFile(null)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={confirmUpload} disabled={uploading}>
              {uploading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.label}
              {toDelete?.file_name ? ` — ${toDelete.file_name}` : ""}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview dialog */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => { if (!o) { setPreviewDoc(null); setPreviewUrl(""); } }}>
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate">{previewDoc?.file_name}</DialogTitle>
            <DialogDescription>
              {previewDoc?.label}
              {previewDoc?.label === "Other" && previewDoc?.label_custom ? ` — ${previewDoc.label_custom}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-muted/30 rounded overflow-hidden">
            {previewDoc && previewUrl && (
              fileKind(previewDoc.mime_type) === "pdf" ? (
                <iframe src={previewUrl} className="w-full h-full" title="document preview" />
              ) : (
                <div className="w-full h-full flex items-center justify-center overflow-auto">
                  <img src={previewUrl} alt={previewDoc.file_name ?? ""} className="max-w-full max-h-full" />
                </div>
              )
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => previewDoc && downloadDoc(previewDoc)}
              disabled={!previewDoc?.storage_path}
            >
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
