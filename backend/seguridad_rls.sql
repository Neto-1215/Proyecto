-- =====================================================================
-- Endurecimiento de Supabase (RLS) para IINICIA
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de revisarlo.
-- Las escrituras privilegiadas (rol, estado, matrículas, inscripciones)
-- pasan por el backend con la service_role, que ignora RLS.
-- ADAPTA los nombres de políticas existentes: primero lista las actuales con:
--   select * from pg_policies where schemaname='public';
--
-- IMPORTANTE: todas las políticas exigen sesión con segundo factor (aal2),
-- así que la clave anon + contraseña NO bastan para leer datos por la API REST.
-- =====================================================================

alter table public.profiles   enable row level security;
alter table public.matriculas enable row level security;
alter table public.tramites   enable row level security;
alter table public.cursos     enable row level security;
alter table public.audit_log  enable row level security;

-- Función auxiliar: rol del usuario actual (security definer evita recursión en RLS)
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.profiles where id = auth.uid()
$$;

-- Función auxiliar: la sesión pasó el segundo factor
create or replace function public.es_aal2() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- ---------- profiles ----------
-- Nadie escribe profiles desde el navegador (lo hace el backend / el trigger de registro).
drop policy if exists "profiles_insert_propio" on public.profiles;
drop policy if exists "profiles_update_admin"  on public.profiles;
drop policy if exists "profiles_update_propio" on public.profiles;
drop policy if exists "profiles_delete"        on public.profiles;
revoke insert, update, delete on public.profiles from anon, authenticated;

-- Lectura: cada quien su perfil; el personal de gestión ve todos (el profesor ya no)
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (
    public.es_aal2()
    and (id = auth.uid() or public.mi_rol() in ('superadmin','administrador','coordinador','soporte'))
  );

-- La contraseña inicial de Moodle NUNCA es legible desde el navegador (solo el backend la lee).
-- Se quita el SELECT de tabla y se concede columna por columna, salvo esa.
revoke select on public.profiles from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'profiles'
     and column_name not in ('moodle_password_inicial');
  execute format('grant select (%s) on public.profiles to authenticated', cols);
end $$;
-- Nota: si añades columnas nuevas a profiles, vuelve a ejecutar este bloque.

-- ---------- matriculas ----------
revoke insert, update, delete on public.matriculas from anon, authenticated;
drop policy if exists "matriculas_select" on public.matriculas;
create policy "matriculas_select" on public.matriculas for select to authenticated
  using (
    public.es_aal2()
    and (user_id = auth.uid() or public.mi_rol() in ('superadmin','administrador','coordinador'))
  );

-- ---------- tramites ----------
-- El usuario puede crear trámites propios, pero NO de inscripción (esos van por el backend,
-- que calcula el monto desde la tabla cursos) ni fijar estado/monto/respuesta.
revoke update, delete on public.tramites from anon, authenticated;
drop policy if exists "tramites_insert_propio" on public.tramites;
create policy "tramites_insert_propio" on public.tramites for insert to authenticated
  with check (
    public.es_aal2()
    and user_id = auth.uid()
    and tipo <> 'Inscripción a curso'
    and monto is null
    and curso_id is null
    and coalesce(estado, 'Solicitado') = 'Solicitado'
    and respuesta is null
  );
drop policy if exists "tramites_select" on public.tramites;
create policy "tramites_select" on public.tramites for select to authenticated
  using (
    public.es_aal2()
    and (user_id = auth.uid() or public.mi_rol() in ('superadmin','administrador','coordinador','soporte'))
  );

-- La atención de trámites (cambiar estado/respuesta) la hace soporte/admin desde el navegador,
-- pero las inscripciones a curso solo las resuelve el backend (crea la matrícula en Moodle).
drop policy if exists "tramites_update_personal" on public.tramites;
grant update (estado, respuesta) on public.tramites to authenticated;
create policy "tramites_update_personal" on public.tramites for update to authenticated
  using (
    public.es_aal2()
    and tipo <> 'Inscripción a curso'
    and public.mi_rol() in ('superadmin','administrador','soporte')
  )
  with check (
    public.es_aal2()
    and tipo <> 'Inscripción a curso'
    and public.mi_rol() in ('superadmin','administrador','soporte')
  );

-- ---------- cursos ----------
revoke insert, update, delete on public.cursos from anon, authenticated;
drop policy if exists "cursos_select" on public.cursos;
create policy "cursos_select" on public.cursos for select to authenticated
  using (public.es_aal2());

-- ---------- audit_log ----------
revoke insert, update, delete on public.audit_log from anon, authenticated;
drop policy if exists "audit_select" on public.audit_log;
create policy "audit_select" on public.audit_log for select to authenticated
  using (public.es_aal2() and public.mi_rol() = 'superadmin');

-- ---------- Trigger de registro (REVISAR) ----------
-- El perfil de un usuario nuevo debe crearse SIEMPRE como aspirante/Pendiente,
-- sin leer rol ni estado de raw_user_meta_data (el cliente controla ese campo).
-- Compara con tu trigger actual y, si lee el rol de los metadatos, reemplázalo con esto
-- (ajusta nombres de columnas/trigger a los tuyos antes de descomentar):
--
-- create or replace function public.handle_new_user() returns trigger
-- language plpgsql security definer set search_path = public as $$
-- begin
--   insert into public.profiles (id, email, nombre, apellidos, rol, estado)
--   values (
--     new.id, new.email,
--     left(coalesce(new.raw_user_meta_data->>'nombre', ''), 80),
--     left(coalesce(new.raw_user_meta_data->>'apellidos', ''), 120),
--     'aspirante', 'Pendiente'
--   );
--   return new;
-- end $$;

-- Configurar en Supabase > Authentication (no se puede por SQL):
--  * Longitud mínima de contraseña >= 10 y "Leaked password protection" activada.
--  * Confirmación de correo obligatoria.
--  * Límites de intentos (rate limits) de inicio de sesión y MFA revisados.
