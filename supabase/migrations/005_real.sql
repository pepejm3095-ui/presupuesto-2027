-- Gasto real mensual por partida (lo captura o carga un administrador) y mes de cierre del ejercicio
create table public.reales (
  ejercicio int not null default 2027,
  linea_id int not null references public.lineas on delete cascade,
  m numeric(14,2)[] not null check (array_length(m,1) = 12),
  nota text not null default '',
  actualizado timestamptz not null default now(),
  actualizado_por text,
  primary key (ejercicio, linea_id)
);
create index on public.reales (linea_id);
create trigger sello before insert or update on public.reales for each row execute function public.sello_montos();

create table public.ejercicios (
  ejercicio int primary key,
  mes_cierre int not null default 0 check (mes_cierre between 0 and 12),
  actualizado timestamptz not null default now(),
  actualizado_por text
);
insert into public.ejercicios (ejercicio) values (2027);

alter table public.reales enable row level security;
alter table public.ejercicios enable row level security;

create policy "ver reales" on public.reales for select to authenticated
  using (exists (select 1 from public.lineas l where l.id = linea_id and public.puede_ver(l.area, l.ceco)));
create policy "alta reales" on public.reales for insert to authenticated with check (public.es_admin());
create policy "cambio reales" on public.reales for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "baja reales" on public.reales for delete to authenticated using (public.es_admin());

create policy "ver ejercicios" on public.ejercicios for select to authenticated using (true);
create policy "cambio ejercicios" on public.ejercicios for update to authenticated using (public.es_admin()) with check (public.es_admin());
