-- Catálogo de cuentas contables, área Ventas y edición de líneas por administradores
create table public.cuentas (
  codigo text primary key,
  nombre text not null,
  padre text,
  nivel int,
  tipo text
);
alter table public.cuentas enable row level security;
create policy "ver cuentas" on public.cuentas for select to authenticated using (true);
create policy "alta cuentas" on public.cuentas for insert to authenticated with check (public.es_admin());
create policy "cambio cuentas" on public.cuentas for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "baja cuentas" on public.cuentas for delete to authenticated using (public.es_admin());

insert into public.areas (k, nombre, orden) values ('ven', 'Ventas', 8) on conflict (k) do nothing;

-- el administrador puede cambiar cualquier dato de una línea y darla de baja
create policy "cambio lineas" on public.lineas for update to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy "baja lineas" on public.lineas;
create policy "baja lineas" on public.lineas for delete to authenticated
  using (public.es_admin() or (origen = 'usuario' and public.puede_editar(area, ceco) and not public.cerrado(2027, area, ceco)));

create or replace function public.sello_linea_cambio() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.id := old.id; new.origen := old.origen; new.creada_por := old.creada_por; new.creada := old.creada;
  new.concepto := upper(trim(new.concepto));
  if new.concepto = '' then raise exception 'El concepto es obligatorio'; end if;
  if new.area is distinct from old.area then
    new.llenado_por := (select translate(upper(a.nombre), 'ÁÉÍÓÚ', 'AEIOU') from public.areas a where a.k = new.area);
  end if;
  return new;
end $$;
create trigger sello_linea_cambio before update on public.lineas for each row execute function public.sello_linea_cambio();
revoke execute on function public.sello_linea_cambio() from public, anon;
