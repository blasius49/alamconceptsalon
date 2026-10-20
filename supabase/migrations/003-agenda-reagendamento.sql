-- Atualiza instalações v1 ou v2. Pode reaplicar: preserva pedidos, sessões e histórico.
BEGIN;
ALTER TABLE public.salon_bookings ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.salon_bookings DROP CONSTRAINT IF EXISTS salon_bookings_status_check;
ALTER TABLE public.salon_bookings ADD CONSTRAINT salon_bookings_status_check CHECK (status IN ('pendente','em_contato','confirmado','reagendar','concluido','cancelado'));
-- Agenda única: todas as mudanças de ocupação adquirem o mesmo lock transacional.
CREATE TABLE IF NOT EXISTS public.salon_agenda_lock (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO public.salon_agenda_lock(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.salon_slot_blocks (
  slot_date date NOT NULL, slot_time time NOT NULL,
  blocked boolean NOT NULL DEFAULT false, reason text NOT NULL DEFAULT '' CHECK(char_length(reason)<=200),
  version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(slot_date,slot_time)
);
CREATE TABLE IF NOT EXISTS public.salon_reschedules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint NOT NULL REFERENCES public.salon_bookings(id),
  from_date date NOT NULL, from_time time NOT NULL, to_date date NOT NULL, to_time time NOT NULL,
  from_status text NOT NULL, to_status text NOT NULL, changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS salon_reschedules_booking ON public.salon_reschedules(booking_id,id);
CREATE INDEX IF NOT EXISTS salon_bookings_agenda_date ON public.salon_bookings(preferred_date,preferred_time);
ALTER TABLE public.salon_agenda_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_slot_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_reschedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_agenda_lock,public.salon_slot_blocks,public.salon_reschedules FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.salon_booking_json(p_id bigint) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('protocol',b.protocol,'name',b.name,'phone',b.phone,'preferredDate',b.preferred_date,
 'preferredTime',to_char(b.preferred_time,'HH24:MI'),'period',CASE WHEN b.preferred_time<time '12:00' THEN 'Manhã' ELSE 'Tarde' END,
 'notes',b.notes,'status',b.status,'createdAt',b.created_at,'updatedAt',b.updated_at,'version',b.version,
 'notification',jsonb_build_object('status',n.status,'errorCode',n.error_code),
 'history',coalesce((SELECT jsonb_agg(jsonb_build_object('fromDate',h.from_date,'fromTime',to_char(h.from_time,'HH24:MI'),
   'toDate',h.to_date,'toTime',to_char(h.to_time,'HH24:MI'),'changedAt',h.changed_at) ORDER BY h.id) FROM public.salon_reschedules h WHERE h.booking_id=b.id),'[]'::jsonb))
 FROM public.salon_bookings b LEFT JOIN public.salon_notifications n ON n.booking_id=b.id WHERE b.id=p_id;
$$;
CREATE OR REPLACE FUNCTION public.salon_slot_taken(p_date date,p_time time,p_except bigint DEFAULT NULL) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.salon_slot_blocks WHERE slot_date=p_date AND slot_time=p_time AND blocked)
 OR EXISTS(SELECT 1 FROM public.salon_bookings WHERE preferred_date=p_date AND preferred_time=p_time
   AND status IN ('confirmado','concluido') AND (p_except IS NULL OR id<>p_except));
$$;
CREATE OR REPLACE FUNCTION public.salon_valid_slot(p_date date,p_time time) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(p_date BETWEEN (now() AT TIME ZONE 'America/Sao_Paulo')::date AND (now() AT TIME ZONE 'America/Sao_Paulo')::date+90
  AND extract(minute FROM p_time)=0 AND extract(second FROM p_time)=0
  AND ((extract(dow FROM p_date)=0 AND p_time BETWEEN time '14:00' AND time '18:00')
   OR (extract(dow FROM p_date)<>0 AND p_time BETWEEN time '09:00' AND time '20:00'))
  AND (p_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date OR p_time>=(now() AT TIME ZONE 'America/Sao_Paulo')::time),false);
$$;
CREATE OR REPLACE FUNCTION public.salon_availability(p_date date) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('blocks',coalesce((SELECT jsonb_agg(jsonb_build_object('time',to_char(slot_time,'HH24:MI'),'blocked',blocked))
 FROM public.salon_slot_blocks WHERE slot_date=p_date AND blocked),'[]'::jsonb),
 'bookings',coalesce((SELECT jsonb_agg(jsonb_build_object('preferredTime',to_char(preferred_time,'HH24:MI'),'status',status))
 FROM public.salon_bookings WHERE preferred_date=p_date AND status IN ('confirmado','concluido')),'[]'::jsonb));
$$;
CREATE OR REPLACE FUNCTION public.salon_agenda(p_date date) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('blocks',coalesce((SELECT jsonb_agg(jsonb_build_object('time',to_char(slot_time,'HH24:MI'),'blocked',blocked,'reason',reason,'version',version))
 FROM public.salon_slot_blocks WHERE slot_date=p_date),'[]'::jsonb),
 'bookings',coalesce((SELECT jsonb_agg(public.salon_booking_json(id) ORDER BY preferred_time,created_at)
 FROM public.salon_bookings WHERE preferred_date=p_date),'[]'::jsonb));
$$;
CREATE OR REPLACE FUNCTION public.salon_set_slot_block(p_date date,p_time time,p_blocked boolean,p_reason text,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.salon_slot_blocks%ROWTYPE; v_version integer;
BEGIN
 IF NOT public.salon_valid_slot(p_date,p_time) OR p_blocked IS NULL OR char_length(p_reason)>200 OR p_reason IS NULL OR p_expected_version<0 OR p_expected_version IS NULL
 THEN RETURN jsonb_build_object('error','invalid_slot'); END IF;
 PERFORM id FROM public.salon_agenda_lock WHERE id=1 FOR UPDATE;
 SELECT * INTO v_row FROM public.salon_slot_blocks WHERE slot_date=p_date AND slot_time=p_time;
 v_version:=coalesce(v_row.version,0);
 IF v_version<>p_expected_version THEN RETURN jsonb_build_object('error','conflict'); END IF;
 IF p_blocked AND EXISTS(SELECT 1 FROM public.salon_bookings WHERE preferred_date=p_date AND preferred_time=p_time AND status IN ('confirmado','concluido'))
 THEN RETURN jsonb_build_object('error','occupied'); END IF;
 INSERT INTO public.salon_slot_blocks(slot_date,slot_time,blocked,reason) VALUES(p_date,p_time,p_blocked,trim(p_reason))
 ON CONFLICT(slot_date,slot_time) DO UPDATE SET blocked=excluded.blocked,reason=excluded.reason,version=salon_slot_blocks.version+1,updated_at=clock_timestamp();
 RETURN jsonb_build_object('ok',true);
END;
$$;
CREATE OR REPLACE FUNCTION public.salon_reschedule_booking(p_protocol text,p_date date,p_time time,p_status text,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.salon_bookings%ROWTYPE;
BEGIN
 IF NOT public.salon_valid_slot(p_date,p_time) OR p_status IS NULL OR p_status NOT IN ('confirmado','em_contato','reagendar') OR p_expected_version<1 OR p_expected_version IS NULL
 THEN RETURN jsonb_build_object('error','invalid_slot'); END IF;
 PERFORM id FROM public.salon_agenda_lock WHERE id=1 FOR UPDATE;
 SELECT * INTO v_row FROM public.salon_bookings WHERE protocol=p_protocol FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF v_row.version<>p_expected_version THEN RETURN jsonb_build_object('error','conflict','booking',public.salon_booking_json(v_row.id)); END IF;
 IF public.salon_slot_taken(p_date,p_time,v_row.id) THEN RETURN jsonb_build_object('error','unavailable'); END IF;
 IF v_row.preferred_date<>p_date OR v_row.preferred_time<>p_time OR v_row.status<>p_status THEN
  INSERT INTO public.salon_reschedules(booking_id,from_date,from_time,to_date,to_time,from_status,to_status)
   VALUES(v_row.id,v_row.preferred_date,v_row.preferred_time,p_date,p_time,v_row.status,p_status);
  UPDATE public.salon_bookings SET preferred_date=p_date,preferred_time=p_time,status=p_status,version=version+1,updated_at=clock_timestamp() WHERE id=v_row.id;
 END IF;
 RETURN jsonb_build_object('booking',public.salon_booking_json(v_row.id));
END;
$$;
CREATE OR REPLACE FUNCTION public.salon_update_booking_status(p_protocol text,p_status text,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.salon_bookings%ROWTYPE;
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('pendente','em_contato','confirmado','reagendar','concluido','cancelado') OR p_expected_version<1 OR p_expected_version IS NULL
 THEN RAISE EXCEPTION 'Invalid status update' USING ERRCODE='22023'; END IF;
 PERFORM id FROM public.salon_agenda_lock WHERE id=1 FOR UPDATE;
 SELECT * INTO v_row FROM public.salon_bookings WHERE protocol=p_protocol FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF v_row.version<>p_expected_version THEN RETURN jsonb_build_object('error','conflict','booking',public.salon_booking_json(v_row.id)); END IF;
 IF p_status IN ('confirmado','concluido') AND v_row.status<>p_status AND public.salon_slot_taken(v_row.preferred_date,v_row.preferred_time,v_row.id)
 THEN RETURN jsonb_build_object('error','unavailable'); END IF;
 IF v_row.status<>p_status THEN
  UPDATE public.salon_bookings SET status=p_status,version=version+1,updated_at=clock_timestamp() WHERE id=v_row.id;
 END IF;
 RETURN jsonb_build_object('booking',public.salon_booking_json(v_row.id));
END;
$$;
CREATE OR REPLACE FUNCTION public.salon_create_booking(p_booking jsonb,p_payload_hash text,p_protocol text,p_notification_ready boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.salon_bookings%ROWTYPE; v_created boolean:=false; v_status text;
 v_date date:=(p_booking->>'preferredDate')::date; v_time time:=(p_booking->>'preferredTime')::time;
BEGIN
 PERFORM id FROM public.salon_agenda_lock WHERE id=1 FOR UPDATE;
 SELECT * INTO v_row FROM public.salon_bookings WHERE request_id=(p_booking->>'requestId')::uuid;
 IF FOUND THEN
  IF v_row.payload_hash<>p_payload_hash THEN RETURN jsonb_build_object('conflict',true); END IF;
 ELSE
  IF p_booking->>'consent' IS DISTINCT FROM 'true' OR NOT public.salon_valid_slot(v_date,v_time) THEN RAISE EXCEPTION 'Invalid booking preferences' USING ERRCODE='22023'; END IF;
  IF public.salon_slot_taken(v_date,v_time) THEN RETURN jsonb_build_object('error','unavailable'); END IF;
  INSERT INTO public.salon_bookings(protocol,request_id,payload_hash,name,phone,preferred_date,preferred_time,notes)
   VALUES(p_protocol,(p_booking->>'requestId')::uuid,p_payload_hash,p_booking->>'name',p_booking->>'phone',v_date,v_time,coalesce(p_booking->>'notes','')) RETURNING * INTO v_row;
  INSERT INTO public.salon_notifications(booking_id,status) VALUES(v_row.id,CASE WHEN p_notification_ready THEN 'queued' ELSE 'not_configured' END);
  v_created:=true;
 END IF;
 SELECT status INTO v_status FROM public.salon_notifications WHERE booking_id=v_row.id;
 RETURN jsonb_build_object('created',v_created,'booking',jsonb_build_object('protocol',v_row.protocol,'status','recebido','createdAt',v_row.created_at,'notification',jsonb_build_object('status',v_status)));
END;
$$;
CREATE OR REPLACE FUNCTION public.salon_health() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('status','ok','schemaVersion',3,'tableAvailable',to_regclass('public.salon_bookings') IS NOT NULL
 AND to_regclass('public.salon_notifications') IS NOT NULL AND to_regclass('public.salon_sessions') IS NOT NULL
 AND to_regclass('public.salon_rate_limits') IS NOT NULL AND to_regclass('public.salon_slot_blocks') IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.salon_agenda_lock WHERE id=1) AND to_regclass('public.salon_reschedules') IS NOT NULL);
$$;
CREATE OR REPLACE FUNCTION public.salon_list_bookings(p_q text DEFAULT '', p_status text DEFAULT '', p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_total bigint; v_items jsonb; v_summary jsonb;
BEGIN
  IF char_length(p_q)>100 OR p_page<1 OR p_page>100000 OR p_status NOT IN ('','pendente','em_contato','confirmado','reagendar','concluido','cancelado') THEN
    RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_total FROM public.salon_bookings b
    WHERE (p_status='' OR b.status=p_status) AND (p_q='' OR position(lower(p_q) IN lower(b.name))>0 OR position(lower(p_q) IN lower(b.protocol))>0);
  SELECT coalesce(jsonb_agg(row_data ORDER BY created_at DESC, id DESC),'[]'::jsonb) INTO v_items FROM (
    SELECT b.id,b.created_at,public.salon_booking_json(b.id) AS row_data
    FROM public.salon_bookings b LEFT JOIN public.salon_notifications n ON n.booking_id=b.id
    WHERE (p_status='' OR b.status=p_status) AND (p_q='' OR position(lower(p_q) IN lower(b.name))>0 OR position(lower(p_q) IN lower(b.protocol))>0)
    ORDER BY b.created_at DESC,b.id DESC LIMIT 20 OFFSET (p_page-1)*20
  ) listed;
  SELECT jsonb_build_object('pendente',count(*) FILTER(WHERE status='pendente'),'em_contato',count(*) FILTER(WHERE status='em_contato'),
    'confirmado',count(*) FILTER(WHERE status='confirmado'),'reagendar',count(*) FILTER(WHERE status='reagendar'),
    'concluido',count(*) FILTER(WHERE status='concluido'),'cancelado',count(*) FILTER(WHERE status='cancelado')) INTO v_summary FROM public.salon_bookings;
  RETURN jsonb_build_object('items',v_items,'total',v_total,'page',p_page,'pages',ceil(v_total/20.0),'summary',v_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.salon_booking_json(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_booking_json(bigint) TO service_role;
REVOKE ALL ON FUNCTION public.salon_slot_taken(date,time,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_slot_taken(date,time,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.salon_valid_slot(date,time) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_valid_slot(date,time) TO service_role;
REVOKE ALL ON FUNCTION public.salon_availability(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_availability(date) TO service_role;
REVOKE ALL ON FUNCTION public.salon_agenda(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_agenda(date) TO service_role;
REVOKE ALL ON FUNCTION public.salon_set_slot_block(date,time,boolean,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_set_slot_block(date,time,boolean,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.salon_reschedule_booking(text,date,time,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_reschedule_booking(text,date,time,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.salon_update_booking_status(text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_update_booking_status(text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.salon_create_booking(jsonb,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_create_booking(jsonb,text,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.salon_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_health() TO service_role;
REVOKE ALL ON FUNCTION public.salon_list_bookings(text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_list_bookings(text,text,integer) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
