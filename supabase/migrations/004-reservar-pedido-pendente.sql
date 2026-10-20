-- Executar depois da migração 003. O primeiro pedido já reserva a vaga.
-- Pedidos e protocolos existentes, inclusive duplicados antigos, são preservados.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.salon_agenda_lock') IS NULL THEN
  RAISE EXCEPTION 'Execute primeiro 003-agenda-reagendamento.sql';
 END IF;
END $$;
-- Serializa a troca da regra com as operações de criação e alteração já existentes.
SELECT id FROM public.salon_agenda_lock WHERE id=1 FOR UPDATE;
CREATE OR REPLACE FUNCTION public.salon_slot_taken(p_date date,p_time time,p_except bigint DEFAULT NULL) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.salon_slot_blocks WHERE slot_date=p_date AND slot_time=p_time AND blocked)
 OR EXISTS(SELECT 1 FROM public.salon_bookings WHERE preferred_date=p_date AND preferred_time=p_time
   AND status IN ('pendente','em_contato','confirmado','concluido') AND (p_except IS NULL OR id<>p_except));
$$;
REVOKE ALL ON FUNCTION public.salon_slot_taken(date,time,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_slot_taken(date,time,bigint) TO service_role;
CREATE OR REPLACE FUNCTION public.salon_availability(p_date date) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('reservationPolicy','request-v1','blocks',coalesce((SELECT jsonb_agg(jsonb_build_object('time',to_char(slot_time,'HH24:MI'),'blocked',blocked))
 FROM public.salon_slot_blocks WHERE slot_date=p_date AND blocked),'[]'::jsonb),
 'bookings',coalesce((SELECT jsonb_agg(jsonb_build_object('preferredTime',to_char(preferred_time,'HH24:MI'),'status',status))
 FROM public.salon_bookings WHERE preferred_date=p_date AND status IN ('pendente','em_contato','confirmado','concluido')),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.salon_availability(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_availability(date) TO service_role;
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
 IF p_blocked AND EXISTS(SELECT 1 FROM public.salon_bookings WHERE preferred_date=p_date AND preferred_time=p_time AND status IN ('pendente','em_contato','confirmado','concluido'))
 THEN RETURN jsonb_build_object('error','occupied'); END IF;
 INSERT INTO public.salon_slot_blocks(slot_date,slot_time,blocked,reason) VALUES(p_date,p_time,p_blocked,trim(p_reason))
 ON CONFLICT(slot_date,slot_time) DO UPDATE SET blocked=excluded.blocked,reason=excluded.reason,version=salon_slot_blocks.version+1,updated_at=clock_timestamp();
 RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.salon_set_slot_block(date,time,boolean,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_set_slot_block(date,time,boolean,text,integer) TO service_role;
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
 IF p_status IN ('pendente','em_contato','confirmado','concluido') AND v_row.status<>p_status AND public.salon_slot_taken(v_row.preferred_date,v_row.preferred_time,v_row.id)
 THEN RETURN jsonb_build_object('error','unavailable'); END IF;
 IF v_row.status<>p_status THEN
  UPDATE public.salon_bookings SET status=p_status,version=version+1,updated_at=clock_timestamp() WHERE id=v_row.id;
 END IF;
 RETURN jsonb_build_object('booking',public.salon_booking_json(v_row.id));
END;
$$;
REVOKE ALL ON FUNCTION public.salon_update_booking_status(text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_update_booking_status(text,text,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.salon_health() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('status','ok','schemaVersion',4,'tableAvailable',to_regclass('public.salon_bookings') IS NOT NULL
 AND to_regclass('public.salon_notifications') IS NOT NULL AND to_regclass('public.salon_sessions') IS NOT NULL
 AND to_regclass('public.salon_rate_limits') IS NOT NULL AND to_regclass('public.salon_slot_blocks') IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.salon_agenda_lock WHERE id=1) AND to_regclass('public.salon_reschedules') IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.salon_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_health() TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
