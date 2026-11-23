revoke execute on function public.mi_email(), public.es_admin(), public.puede_editar(text,text), public.puede_ver(text,text), public.cerrado(int,text,text), public.linea_editable(int,int), public.sello_montos() from public, anon;
grant execute on function public.mi_email(), public.es_admin(), public.puede_editar(text,text), public.puede_ver(text,text), public.cerrado(int,text,text), public.linea_editable(int,int) to authenticated;
-- primer administrador
-- insert into public.accesos(email, rol) values ('administracion.finanzas@globaltech.com.mc','admin');
