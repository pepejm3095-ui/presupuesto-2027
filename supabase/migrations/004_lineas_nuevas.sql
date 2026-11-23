-- Líneas de gasto agregadas por usuarios (área con permiso de captura o administrador)
create sequence public.lineas_nuevas_seq start 100000;
alter table public.lineas
  add column origen text not null default 'formato' check (origen in ('formato','usuario')),
  add column creada_por text,
  add column creada timestamptz;

-- si se borra una línea agregada, se borran sus montos
alter table public.montos drop constraint montos_linea_id_fkey,
  add constraint montos_linea_id_fkey foreign key (linea_id) references public.lineas(id) on delete cascade;

create or replace function public.sello_linea() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.origen := 'usuario';
  new.creada_por := public.mi_email();
  new.creada := now();
  new.id := nextval('public.lineas_nuevas_seq');
  new.concepto := upper(trim(new.concepto));
  if new.concepto = '' then raise exception 'El concepto es obligatorio'; end if;
  new.llenado_por := (select translate(upper(a.nombre), 'ÁÉÍÓÚ', 'AEIOU') from public.areas a where a.k = new.area);
  return new;
end $$;
create trigger sello_linea before insert on public.lineas for each row execute function public.sello_linea();

create policy "alta lineas" on public.lineas for insert to authenticated
  with check (public.es_admin() or (public.puede_editar(area, ceco) and not public.cerrado(2027, area, ceco)));
create policy "baja lineas" on public.lineas for delete to authenticated
  using (origen = 'usuario' and (public.es_admin() or (public.puede_editar(area, ceco) and not public.cerrado(2027, area, ceco))));
grant usage on sequence public.lineas_nuevas_seq to authenticated;
revoke execute on function public.sello_linea() from public, anon;
