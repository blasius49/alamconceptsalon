-- Atualização da situação dos pedidos. Pode executar novamente sem apagar dados.
BEGIN;
ALTER TABLE public.salon_bookings ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.salon_bookings DROP CONSTRAINT IF EXISTS salon_bookings_status_check;
ALTER TABLE public.salon_bookings ADD CONSTRAINT salon_bookings_status_check CHECK (status IN ('pendente','em_contato','confirmado','reagendar','concluido','cancelado'));
CREATE OR REPLACE FUNCTION public.salon_health() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('status','ok','schemaVersion',2,'tableAvailable',to_regclass('public.salon_bookings') IS NOT NULL AND to_regclass('public.salon_notifications') IS NOT NULL AND to_regclass('public.salon_sessions') IS NOT NULL AND to_regclass('public.salon_rate_limits') IS NOT NULL);
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
    SELECT b.id,b.created_at,jsonb_build_object('protocol',b.protocol,'name',b.name,'phone',b.phone,'preferredDate',b.preferred_date,
      'preferredTime',to_char(b.preferred_time,'HH24:MI'),'period',CASE WHEN b.preferred_time < time '12:00' THEN 'Manhã' ELSE 'Tarde' END,
      'notes',b.notes,'status',b.status,'createdAt',b.created_at,'updatedAt',b.updated_at,'version',b.version,'notification',jsonb_build_object('status',n.status,'errorCode',n.error_code)) AS row_data
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

CREATE OR REPLACE FUNCTION public.salon_update_booking_status(p_protocol text,p_status text,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.salon_bookings%ROWTYPE;
BEGIN
  IF p_status NOT IN ('pendente','em_contato','confirmado','reagendar','concluido','cancelado') OR p_expected_version<1 OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'Invalid status update' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.salon_bookings WHERE protocol=p_protocol FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF v_row.version<>p_expected_version THEN
    RETURN jsonb_build_object('error','conflict','booking',jsonb_build_object('protocol',v_row.protocol,'status',v_row.status,'version',v_row.version,'updatedAt',v_row.updated_at));
  END IF;
  IF v_row.status<>p_status THEN
    UPDATE public.salon_bookings SET status=p_status,version=version+1,updated_at=clock_timestamp() WHERE id=v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object('booking',jsonb_build_object('protocol',v_row.protocol,'status',v_row.status,'version',v_row.version,'updatedAt',v_row.updated_at));
END;
$$;
REVOKE ALL ON FUNCTION public.salon_update_booking_status(text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_update_booking_status(text,text,integer) TO service_role;

REVOKE ALL ON FUNCTION public.salon_list_bookings(text,text,integer), public.salon_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salon_list_bookings(text,text,integer), public.salon_health() TO service_role;
COMMIT;
