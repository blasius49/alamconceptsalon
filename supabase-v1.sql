-- Execute no SQL Editor de um projeto Supabase. Reaplicar preserva os dados.
-- As tabelas não têm políticas públicas. Somente o backend com secret/service key usa as RPCs.
BEGIN;
CREATE TABLE IF NOT EXISTS public.salon_bookings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  protocol text NOT NULL UNIQUE,
  request_id uuid NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  phone text NOT NULL CHECK (phone ~ '^55[1-9][0-9][0-9]{8,9}$'),
  preferred_date date NOT NULL,
  preferred_time time NOT NULL CHECK (extract(minute FROM preferred_time) = 0 AND extract(second FROM preferred_time) = 0),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  consent_at timestamptz NOT NULL DEFAULT now(),
  consent_version text NOT NULL DEFAULT 'contact-whatsapp-v2',
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_contato','concluido','cancelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salon_bookings_status_date ON public.salon_bookings(status, preferred_date);
CREATE TABLE IF NOT EXISTS public.salon_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint NOT NULL UNIQUE REFERENCES public.salon_bookings(id),
  status text NOT NULL CHECK (status IN ('not_configured','queued','sending','accepted','failed','uncertain','expired')),
  provider_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salon_notifications_status ON public.salon_notifications(status, created_at);
CREATE TABLE IF NOT EXISTS public.salon_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  password_version text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.salon_rate_limits (
  key_hash text NOT NULL,
  bucket timestamptz NOT NULL,
  attempts integer NOT NULL,
  PRIMARY KEY (key_hash, bucket)
);
CREATE INDEX IF NOT EXISTS salon_rate_limits_bucket ON public.salon_rate_limits(bucket);
ALTER TABLE public.salon_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_bookings, public.salon_notifications, public.salon_sessions, public.salon_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.salon_health() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('status','ok','schemaVersion',1,'tableAvailable',to_regclass('public.salon_bookings') IS NOT NULL AND to_regclass('public.salon_notifications') IS NOT NULL AND to_regclass('public.salon_sessions') IS NOT NULL AND to_regclass('public.salon_rate_limits') IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.salon_create_booking(p_booking jsonb, p_payload_hash text, p_protocol text, p_notification_ready boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.salon_bookings%ROWTYPE;
  v_created integer;
  v_status text;
  v_date date := (p_booking->>'preferredDate')::date;
  v_time time := (p_booking->>'preferredTime')::time;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF p_booking->>'consent' IS DISTINCT FROM 'true' OR v_date < v_today OR v_date > v_today + 90
    OR extract(minute FROM v_time) <> 0 OR extract(second FROM v_time) <> 0
    OR (extract(dow FROM v_date) = 0 AND (v_time < time '14:00' OR v_time > time '18:00'))
    OR (extract(dow FROM v_date) <> 0 AND (v_time < time '09:00' OR v_time > time '20:00'))
    OR (v_date = v_today AND v_time < (now() AT TIME ZONE 'America/Sao_Paulo')::time)
  THEN RAISE EXCEPTION 'Invalid booking preferences' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.salon_bookings(protocol,request_id,payload_hash,name,phone,preferred_date,preferred_time,notes)
  VALUES(p_protocol,(p_booking->>'requestId')::uuid,p_payload_hash,p_booking->>'name',p_booking->>'phone',v_date,v_time,coalesce(p_booking->>'notes',''))
  ON CONFLICT(request_id) DO NOTHING;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  SELECT * INTO v_row FROM public.salon_bookings WHERE request_id=(p_booking->>'requestId')::uuid;
  IF v_row.payload_hash <> p_payload_hash THEN RETURN jsonb_build_object('conflict',true); END IF;
  IF v_created = 1 THEN
    INSERT INTO public.salon_notifications(booking_id,status) VALUES(v_row.id,CASE WHEN p_notification_ready THEN 'queued' ELSE 'not_configured' END);
  END IF;
  SELECT status INTO v_status FROM public.salon_notifications WHERE booking_id=v_row.id;
  RETURN jsonb_build_object('created',v_created=1,'booking',jsonb_build_object('protocol',v_row.protocol,'status','recebido','createdAt',v_row.created_at,'notification',jsonb_build_object('status',v_status)));
END;
$$;

CREATE OR REPLACE FUNCTION public.salon_list_bookings(p_q text DEFAULT '', p_status text DEFAULT '', p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_total bigint; v_items jsonb; v_summary jsonb;
BEGIN
  IF char_length(p_q)>100 OR p_page<1 OR p_page>100000 OR p_status NOT IN ('','pendente','em_contato','concluido','cancelado') THEN
    RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_total FROM public.salon_bookings b
    WHERE (p_status='' OR b.status=p_status) AND (p_q='' OR position(lower(p_q) IN lower(b.name))>0 OR position(lower(p_q) IN lower(b.protocol))>0);
  SELECT coalesce(jsonb_agg(row_data ORDER BY created_at DESC, id DESC),'[]'::jsonb) INTO v_items FROM (
    SELECT b.id,b.created_at,jsonb_build_object('protocol',b.protocol,'name',b.name,'phone',b.phone,'preferredDate',b.preferred_date,
      'preferredTime',to_char(b.preferred_time,'HH24:MI'),'period',CASE WHEN b.preferred_time < time '12:00' THEN 'Manhã' ELSE 'Tarde' END,
      'notes',b.notes,'status',b.status,'createdAt',b.created_at,'notification',jsonb_build_object('status',n.status,'errorCode',n.error_code)) AS row_data
    FROM public.salon_bookings b LEFT JOIN public.salon_notifications n ON n.booking_id=b.id
    WHERE (p_status='' OR b.status=p_status) AND (p_q='' OR position(lower(p_q) IN lower(b.name))>0 OR position(lower(p_q) IN lower(b.protocol))>0)
    ORDER BY b.created_at DESC,b.id DESC LIMIT 20 OFFSET (p_page-1)*20
  ) listed;
  SELECT jsonb_build_object('pendente',count(*) FILTER(WHERE status='pendente'),'em_contato',count(*) FILTER(WHERE status='em_contato'),
    'concluido',count(*) FILTER(WHERE status='concluido'),'cancelado',count(*) FILTER(WHERE status='cancelado')) INTO v_summary FROM public.salon_bookings;
  RETURN jsonb_build_object('items',v_items,'total',v_total,'page',p_page,'pages',ceil(v_total/20.0),'summary',v_summary);
END;
$$;

CREATE OR REPLACE FUNCTION public.salon_rate_limit(p_key_hash text,p_limit integer,p_window_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_bucket timestamptz; v_count integer;
BEGIN
  IF p_limit<1 OR p_limit>1000 OR p_window_seconds<1 OR p_window_seconds>3600 OR p_key_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid rate limit'; END IF;
  v_bucket := to_timestamp(floor(extract(epoch FROM clock_timestamp())/p_window_seconds)*p_window_seconds);
  DELETE FROM public.salon_rate_limits WHERE bucket < now()-interval '1 day';
  INSERT INTO public.salon_rate_limits(key_hash,bucket,attempts) VALUES(p_key_hash,v_bucket,1)
    ON CONFLICT(key_hash,bucket) DO UPDATE SET attempts=public.salon_rate_limits.attempts+1 RETURNING attempts INTO v_count;
  RETURN jsonb_build_object('allowed',v_count<=p_limit,'retryAfter',greatest(1,ceil(extract(epoch FROM v_bucket+make_interval(secs=>p_window_seconds)-clock_timestamp()))));
END;
$$;

CREATE OR REPLACE FUNCTION public.salon_session_create(p_token_hash text,p_password_version text,p_expires_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  DELETE FROM public.salon_sessions WHERE expires_at < now();
  INSERT INTO public.salon_sessions(token_hash,password_version,expires_at) VALUES(p_token_hash,p_password_version,least(p_expires_at,now()+interval '8 hours'));
  RETURN true;
END;
$$;
CREATE OR REPLACE FUNCTION public.salon_session_valid(p_token_hash text,p_password_version text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.salon_sessions WHERE token_hash=p_token_hash AND password_version=p_password_version AND expires_at>now());
$$;
CREATE OR REPLACE FUNCTION public.salon_session_revoke(p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN DELETE FROM public.salon_sessions WHERE token_hash=p_token_hash; RETURN true; END;
$$;

CREATE OR REPLACE FUNCTION public.salon_claim_notification()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id bigint; v_result jsonb;
BEGIN
  UPDATE public.salon_notifications SET status='uncertain',error_code='interrupted',updated_at=now() WHERE status='sending' AND updated_at<now()-interval '2 minutes';
  UPDATE public.salon_notifications SET status='expired',error_code='stale_request',updated_at=now() WHERE status='queued' AND created_at<now()-interval '1 hour';
  SELECT id INTO v_id FROM public.salon_notifications WHERE status='queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.salon_notifications SET status='sending',updated_at=now() WHERE id=v_id;
  SELECT jsonb_build_object('id',n.id,'name',b.name,'phone',b.phone,'protocol',b.protocol,'preferred_date',b.preferred_date,'preferred_time',to_char(b.preferred_time,'HH24:MI'))
    INTO v_result FROM public.salon_notifications n JOIN public.salon_bookings b ON b.id=n.booking_id WHERE n.id=v_id;
  RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION public.salon_finish_notification(p_id bigint,p_status text,p_provider_id text DEFAULT NULL,p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_status NOT IN ('accepted','failed','uncertain') THEN RAISE EXCEPTION 'Invalid notification result'; END IF;
 UPDATE public.salon_notifications SET status=p_status,provider_id=p_provider_id,error_code=p_error_code,updated_at=now() WHERE id=p_id AND status='sending';
 RETURN FOUND;
END;
$$;

-- Remover permissões implícitas de execução em funções novas. Não usar a chave anon no backend.
REVOKE ALL ON FUNCTION public.salon_health() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.salon_create_booking(jsonb,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.salon_list_bookings(text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.salon_rate_limit(text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.salon_session_create(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.salon_session_valid(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.salon_session_revoke(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.salon_claim_notification() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.salon_finish_notification(bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_health(),public.salon_create_booking(jsonb,text,text,boolean),public.salon_list_bookings(text,text,integer),
  public.salon_rate_limit(text,integer,integer),public.salon_session_create(text,text,timestamptz),public.salon_session_valid(text,text),
  public.salon_session_revoke(text),public.salon_claim_notification(),public.salon_finish_notification(bigint,text,text,text) TO service_role;
COMMIT;
