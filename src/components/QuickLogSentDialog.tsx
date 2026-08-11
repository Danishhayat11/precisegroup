import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  createMetadataDoc,
  SENT_VIA_OPTIONS,
  type SentVia,
} from "@/lib/bookingDocuments";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  /** Vault label this notice should be filed under, e.g. "Legal Notice Sent". */
  label: string;
  /** Notice / document reference number — stored in `notes` and shown in the title. */
  referenceNo?: string | null;
  /** Free-text describing what was sent (e.g. "Legal Notice — Show Cause"). */
  documentType?: string | null;
  /** Optional onSaved callback. */
  onSaved?: (id: string) => void;
}

/**
 * "Mark as Sent" quick-log popup shown right after printing a notice.
 * Creates a metadata-only `booking_documents` row so the vault tracks delivery
 * even when no scanned copy is uploaded yet.
 */
export default function QuickLogSentDialog({
  open, onOpenChange, bookingId, label, referenceNo, documentType, onSaved,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [sentVia, setSentVia] = useState<SentVia | "">("TCS Courier");
  const [tcsTracking, setTcsTracking] = useState("");
  const [whatsappTo, setWhatsappTo] = useState("");
  const [dateSent, setDateSent] = useState(format(new Date(), "yyyy-MM-dd"));
  const [extraNotes, setExtraNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset fields each time the dialog opens for a different notice.
  useEffect(() => {
    if (!open) return;
    setSentVia("TCS Courier");
    setTcsTracking("");
    setWhatsappTo("");
    setDateSent(format(new Date(), "yyyy-MM-dd"));
    setExtraNotes("");
  }, [open, label, referenceNo]);

  const needsTcs = sentVia === "TCS Courier" || sentVia === "Both";
  const needsWa = sentVia === "WhatsApp" || sentVia === "Both";

  async function save() {
    if (!sentVia) {
      toast({ variant: "destructive", title: "Choose how the notice was sent" });
      return;
    }
    if (needsTcs && !tcsTracking.trim()) {
      toast({ variant: "destructive", title: "TCS tracking number required" });
      return;
    }
    if (needsWa && !whatsappTo.trim()) {
      toast({ variant: "destructive", title: "WhatsApp number required" });
      return;
    }
    setSaving(true);
    try {
      const notes = [
        documentType ? `Document: ${documentType}` : null,
        referenceNo ? `Ref: ${referenceNo}` : null,
        extraNotes.trim() || null,
      ].filter(Boolean).join(" · ");
      const row = await createMetadataDoc({
        bookingId,
        label,
        documentDate: dateSent,
        notes: notes || undefined,
        source: "notice",
        sentVia: sentVia as SentVia,
        tcsTrackingNo: needsTcs ? tcsTracking.trim() : undefined,
        whatsappSentTo: needsWa ? whatsappTo.trim() : null,
      });
      toast({
        title: "Marked as sent",
        description: `${label} logged to the Document Vault.`,
      });
      qc.invalidateQueries({ queryKey: ["booking-documents", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-document-summaries"] });
      onSaved?.(row.id);
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ variant: "destructive", title: "Save failed", description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark notice as sent</DialogTitle>
          <DialogDescription>
            Logs delivery to the Document Vault as <span className="font-medium">{label}</span>.
            {referenceNo && <> Ref <span className="font-mono">{referenceNo}</span>.</>}
            {" "}You can still upload the scanned copy later from the Vault.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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

          {needsTcs && (
            <div>
              <Label className="text-xs">TCS Tracking No. *</Label>
              <Input
                value={tcsTracking}
                onChange={(e) => setTcsTracking(e.target.value)}
                placeholder="e.g. 1234567890"
              />
            </div>
          )}
          {needsWa && (
            <div>
              <Label className="text-xs">WhatsApp sent to *</Label>
              <Input
                value={whatsappTo}
                onChange={(e) => setWhatsappTo(e.target.value)}
                placeholder="e.g. +92 333 1234567"
              />
            </div>
          )}

          <div>
            <Label className="text-xs">Date Sent *</Label>
            <Input type="date" value={dateSent} onChange={(e) => setDateSent(e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              rows={2}
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              placeholder="e.g. delivered to receptionist"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Log as sent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
