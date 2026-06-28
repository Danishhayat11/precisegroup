import { supabase } from "@/integrations/supabase/client";

export const LABEL_OPTIONS = [
  "Agreement to Sell / Booking Form",
  "Client CNIC Copy",
  "Client Photo",
  "Payment Receipt (Scanned)",
  "Legal Notice Sent",
  "Final Legal Notice Sent",
  "Cancellation Notice Sent",
  "Client Reply / Response Received",
  "Court Letter / Legal Correspondence",
  "Cheque Copy",
  "Bank Transfer Slip",
  "Allotment Letter (Signed Copy)",
  "Possession Letter (Signed Copy)",
  "Transfer Form (Signed)",
  "NOC / Clearance Certificate",
  "Affidavit",
  "Other",
] as const;

export type DocLabel = (typeof LABEL_OPTIONS)[number];

export const MANDATORY_LABELS = ["Agreement to Sell / Booking Form"];
export const GREEN_REQUIRED_LABELS = [
  "Agreement to Sell / Booking Form",
  "Client CNIC Copy",
];

export const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

export const MAX_BYTES = 10 * 1024 * 1024;
export const BUCKET = "booking-documents";

export const SENT_VIA_OPTIONS = [
  "TCS Courier",
  "WhatsApp",
  "Both",
  "Email",
  "In Person",
] as const;
export type SentVia = (typeof SENT_VIA_OPTIONS)[number];

/** Labels that represent a notice / letter that was *sent* to the client.
 *  When uploading one of these we surface the Sent-Via metadata fields. */
export const NOTICE_LABELS: ReadonlySet<string> = new Set([
  "Legal Notice Sent",
  "Final Legal Notice Sent",
  "Cancellation Notice Sent",
  "Client Reply / Response Received",
  "Court Letter / Legal Correspondence",
]);

export interface BookingDocument {
  id: string;
  booking_id: string;
  label: string;
  label_custom: string | null;
  document_date: string;
  notes: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  source: string;
  tcs_tracking_no: string | null;
  sent_via: SentVia | null;
  whatsapp_sent_to: string | null;
  created_at: string;
  updated_at: string;
}


export function fmtSize(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export type FileKind = "pdf" | "word" | "image" | "other";

export function fileKind(mime?: string | null): FileKind {
  if (!mime) return "other";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("word") || mime.includes("officedocument")) return "word";
  return "other";
}

export async function listDocs(bookingId: string): Promise<BookingDocument[]> {
  const { data, error } = await supabase
    .from("booking_documents")
    .select("*")
    .eq("booking_id", bookingId)
    .order("document_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BookingDocument[];
}

export async function uploadDoc(params: {
  bookingId: string;
  file: File;
  label: string;
  labelCustom?: string;
  documentDate: string;
  notes?: string;
  source?: string;
  tcsTrackingNo?: string;
  sentVia?: SentVia | null;
  whatsappSentTo?: string | null;
}): Promise<BookingDocument> {
  const { bookingId, file, label, labelCustom, documentDate, notes, source, tcsTrackingNo, sentVia, whatsappSentTo } = params;
  if (file.size > MAX_BYTES) throw new Error("File exceeds 10MB limit.");
  if (file.type && !ALLOWED_MIME.includes(file.type)) {
    throw new Error("Unsupported file type. Use PDF, JPG, PNG, or DOCX.");
  }

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  const userName =
    (auth.user?.user_metadata as any)?.full_name ??
    auth.user?.email ??
    null;

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const id = crypto.randomUUID();
  const path = `bookings/${bookingId}/${id}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  const insertRow = {
    booking_id: bookingId,
    label,
    label_custom: label === "Other" ? labelCustom ?? null : null,
    document_date: documentDate,
    notes: notes ?? null,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    uploaded_by: userId,
    uploaded_by_name: userName,
    source: source ?? "manual",
    tcs_tracking_no: tcsTrackingNo ?? null,
    sent_via: sentVia ?? null,
    whatsapp_sent_to: whatsappSentTo ?? null,
  };
  const { data, error } = await supabase
    .from("booking_documents")
    .insert(insertRow)
    .select("*")
    .single();
  if (error) {
    // Roll back the file
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  return data as BookingDocument;
}

export async function createMetadataDoc(params: {
  bookingId: string;
  label: string;
  documentDate: string;
  notes?: string;
  source: string;
  tcsTrackingNo?: string;
  sentVia?: SentVia | null;
  whatsappSentTo?: string | null;
}): Promise<BookingDocument> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  const userName =
    (auth.user?.user_metadata as any)?.full_name ??
    auth.user?.email ??
    null;
  const { data, error } = await supabase
    .from("booking_documents")
    .insert({
      booking_id: params.bookingId,
      label: params.label,
      document_date: params.documentDate,
      notes: params.notes ?? null,
      source: params.source,
      tcs_tracking_no: params.tcsTrackingNo ?? null,
      sent_via: params.sentVia ?? null,
      whatsapp_sent_to: params.whatsappSentTo ?? null,
      uploaded_by: userId,
      uploaded_by_name: userName,
      storage_path: null,
      file_name: null,
      mime_type: null,
      size_bytes: null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as BookingDocument;
}

export async function deleteDoc(doc: BookingDocument): Promise<void> {
  if (doc.storage_path) {
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  }
  const { error } = await supabase.from("booking_documents").delete().eq("id", doc.id);
  if (error) throw error;
}

export async function signedUrl(path: string, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}



export async function downloadDoc(doc: BookingDocument): Promise<void> {
  if (!doc.storage_path) throw new Error("This entry has no attached file.");
  const url = await signedUrl(doc.storage_path, 120);
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.file_name ?? "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface DocSummary {
  count: number;
  hasAgreement: boolean;
  hasCnic: boolean;
}

export async function fetchDocSummaries(): Promise<Record<string, DocSummary>> {
  const { data, error } = await supabase
    .from("booking_documents")
    .select("booking_id,label");
  if (error) throw error;
  const out: Record<string, DocSummary> = {};
  for (const r of data ?? []) {
    const k = (r as any).booking_id as string;
    const s = (out[k] ||= { count: 0, hasAgreement: false, hasCnic: false });
    s.count++;
    if ((r as any).label === "Agreement to Sell / Booking Form") s.hasAgreement = true;
    if ((r as any).label === "Client CNIC Copy") s.hasCnic = true;
  }
  return out;
}
