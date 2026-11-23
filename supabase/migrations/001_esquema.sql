-- Aplicado en el proyecto Supabase existente (qqbirpskkhwwsdbkbzyg)
-- Presupuesto de gastos de operación · esquema base
create table public.areas (
  k text primary key,
  nombre text not null,
  orden int not null default 0
);

create table public.departamentos (
  ceco text primary key,
  nombre text not null
);

create table public.lineas (
  id int primary key,               -- fila del formato original
  rubro text not null,
  concepto text not null,
  cuenta text,
  descripcion text,
  ceco text not null references public.departamentos,
  area text not null references public.areas,
  llenado_por text not null
);
create index on public.lineas (area, ceco);

-- rol: admin (todo), captura (edita su área; ceco nulo = todos los departamentos del área),
--      consulta (solo lectura de un departamento; área nula = todas las áreas)
create table public.accesos (
  id bigint generated always as identity primary key,
  email text not null check (email = lower(email)),
  rol text not null default 'captura' check (rol in ('admin','captura','consulta')),
  area text references public.areas,
  ceco text references public.departamentos,
  creado timestamptz not null default now(),
  constraint accesos_unico unique nulls not distinct (email, rol, area, ceco),
  constraint accesos_forma check (
    (rol = 'admin' and area is null and ceco is null) or
    (rol = 'captura' and area is not null) or
    (rol = 'consulta' and ceco is not null))
);
create index on public.accesos (email);

-- códigos de activación (solo los usa la función "cuentas" con la llave de servicio)
create table public.activaciones (
  email text primary key,
  codigo_hash text not null,
  expira timestamptz not null,
  intentos int not null default 0
);

create table public.montos (
  ejercicio int not null default 2027,
  linea_id int not null references public.lineas,
  m numeric(14,2)[] not null check (array_length(m,1) = 12),
  nota text not null default '',
  actualizado timestamptz not null default now(),
  actualizado_por text,
  primary key (ejercicio, linea_id)
);
create index on public.montos (linea_id);

create table public.capturas (
  ejercicio int not null default 2027,
  area text not null references public.areas,
  ceco text not null references public.departamentos,
  estado text not null default 'captura' check (estado in ('captura','enviado')),
  actualizado timestamptz not null default now(),
  actualizado_por text,
  primary key (ejercicio, area, ceco)
);

-- ===== funciones de permisos =====
create or replace function public.mi_email() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce((select auth.jwt()) ->> 'email', ''))
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.accesos a where a.email = public.mi_email() and a.rol = 'admin')
$$;

create or replace function public.puede_editar(p_area text, p_ceco text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.es_admin() or exists (
    select 1 from public.accesos a
    where a.email = public.mi_email() and a.rol = 'captura'
      and a.area = p_area and (a.ceco is null or a.ceco = p_ceco))
$$;

create or replace function public.puede_ver(p_area text, p_ceco text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.puede_editar(p_area, p_ceco) or exists (
    select 1 from public.accesos a
    where a.email = public.mi_email() and a.rol = 'consulta'
      and a.ceco = p_ceco and (a.area is null or a.area = p_area))
$$;

create or replace function public.cerrado(p_ejercicio int, p_area text, p_ceco text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.capturas c
    where c.ejercicio = p_ejercicio and c.area = p_area and c.ceco = p_ceco and c.estado = 'enviado')
$$;

create or replace function public.linea_editable(p_ejercicio int, p_linea int) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lineas l where l.id = p_linea
    and (public.es_admin() or (public.puede_editar(l.area, l.ceco) and not public.cerrado(p_ejercicio, l.area, l.ceco))))
$$;

-- ===== RLS =====
alter table public.areas enable row level security;
alter table public.departamentos enable row level security;
alter table public.lineas enable row level security;
alter table public.accesos enable row level security;
alter table public.activaciones enable row level security;
alter table public.montos enable row level security;
alter table public.capturas enable row level security;

create policy "catalogo areas" on public.areas for select to authenticated using (true);
create policy "catalogo deptos" on public.departamentos for select to authenticated using (true);
create policy "ver lineas" on public.lineas for select to authenticated using (public.puede_ver(area, ceco));

create policy "ver accesos" on public.accesos for select to authenticated
  using (email = public.mi_email() or public.es_admin());
create policy "alta accesos" on public.accesos for insert to authenticated with check (public.es_admin());
create policy "cambio accesos" on public.accesos for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "baja accesos" on public.accesos for delete to authenticated using (public.es_admin());

create policy "ver montos" on public.montos for select to authenticated
  using (exists (select 1 from public.lineas l where l.id = linea_id and public.puede_ver(l.area, l.ceco)));
create policy "alta montos" on public.montos for insert to authenticated with check (public.linea_editable(ejercicio, linea_id));
create policy "cambio montos" on public.montos for update to authenticated
  using (public.linea_editable(ejercicio, linea_id)) with check (public.linea_editable(ejercicio, linea_id));
create policy "baja montos" on public.montos for delete to authenticated using (public.linea_editable(ejercicio, linea_id));

create policy "ver capturas" on public.capturas for select to authenticated using (public.puede_ver(area, ceco));
-- capturas se modifican solo con enviar()/reabrir()

-- quién y cuándo
create or replace function public.sello_montos() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado := now();
  new.actualizado_por := public.mi_email();
  return new;
end $$;
create trigger sello before insert or update on public.montos for each row execute function public.sello_montos();

-- ===== acciones =====
create or replace function public.enviar(p_area text, p_ejercicio int default 2027) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.capturas (ejercicio, area, ceco, estado, actualizado, actualizado_por)
  select distinct p_ejercicio, l.area, l.ceco, 'enviado', now(), public.mi_email()
  from public.lineas l
  where l.area = p_area and public.puede_editar(l.area, l.ceco)
  on conflict (ejercicio, area, ceco) do update
    set estado = 'enviado', actualizado = now(), actualizado_por = excluded.actualizado_por;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Sin permiso para enviar esta área'; end if;
  return n;
end $$;

create or replace function public.reabrir(p_area text, p_ceco text default null, p_ejercicio int default 2027) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede reabrir capturas'; end if;
  update public.capturas set estado = 'captura', actualizado = now(), actualizado_por = public.mi_email()
  where ejercicio = p_ejercicio and area = p_area and (p_ceco is null or ceco = p_ceco);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.enviar(text,int), public.reabrir(text,text,int) from public, anon;
grant execute on function public.enviar(text,int), public.reabrir(text,text,int) to authenticated;
revoke all on public.activaciones from anon, authenticated;
