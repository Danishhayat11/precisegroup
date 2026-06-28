CREATE OR REPLACE FUNCTION public.next_notice_serial(_booking_id text, _year int)
RETURNS int
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(serial), 0) + 1
  FROM public.notices
  WHERE booking_id = _booking_id AND year = _year;
$$;