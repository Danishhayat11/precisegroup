
ALTER TABLE public.booking_documents ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE public.booking_documents ALTER COLUMN file_name DROP NOT NULL;
ALTER TABLE public.booking_documents ALTER COLUMN mime_type DROP NOT NULL;
ALTER TABLE public.booking_documents ALTER COLUMN size_bytes DROP NOT NULL;
