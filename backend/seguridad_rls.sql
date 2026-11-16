-- =====================================================================
-- Endurecimiento de Supabase (RLS) para IINICIA
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de revisarlo.
-- Las escrituras privilegiadas (rol, estado, matrículas, inscripciones)
-- ahora pasan por el backend con la service_role, que ignora RLS.
-- Por eso el navegador (clave anon) ya no necesita permisos de escritura
-- sobre esos datos. ADAPTA los nombres de políticas existentes: primero
-- lista las actuales con:  select * from pg_policies where schemaname='public';
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

-- ---------- profiles ----------
-- Nadie escribe profiles desde el navegador (lo hace el backend / el trigger de registro).
drop policy if exists "profiles_insert_propio" on public.profiles;
drop policy if exists "profiles_update_admin"  on public.profiles;
drop policy if exists "profiles_update_propio" on public.profiles;
drop policy if exists "profiles_delete"        on public.profiles;
revoke insert, update, delete on public.profiles from anon, authenticated;

-- Lectura: cada quien su perfil; el personal de gestión ve todos
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = auth.uid() or public.mi_rol() in ('superadmin','administrador','coordinador','soporte','profesor'));

-- ---------- matriculas ----------
revoke insert, update, delete on public.matriculas from anon, authenticated;
drop policy if exists "matriculas_select" on public.matriculas;
create policy "matriculas_select" on public.matriculas for select to authenticated
  using (user_id = auth.uid() or public.mi_rol() in ('superadmin','administrador','coordinador'));

-- ---------- tramites ----------
-- El usuario puede crear trámites propios, pero NO de inscripción (esos van por el backend,
-- que calcula el monto desde la tabla cursos) ni fijar estado/monto/respuesta.
revoke update, delete on public.tramites from anon, authenticated;
drop policy if exists "tramites_insert_propio" on public.tramites;
create policy "tramites_insert_propio" on public.tramites for insert to authenticated
  with check (
    user_id = auth.uid()
    and tipo <> 'Inscripción a curso'
    and monto is null
    and curso_id is null
    and coalesce(estado, 'Solicitado') = 'Solicitado'
    and respuesta is null
  );
drop policy if exists "tramites_select" on public.tramites;
create policy "tramites_select" on public.tramites for select to authenticated
  using (user_id = auth.uid() or public.mi_rol() in ('superadmin','administrador','coordinador','soporte'));

-- La atención de trámites (cambiar estado/respuesta) la hace soporte/admin desde el navegador:
drop policy if exists "tramites_update_personal" on public.tramites;
grant update (estado, respuesta) on public.tramites to authenticated;
create policy "tramites_update_personal" on public.tramites for update to authenticated
  using (public.mi_rol() in ('superadmin','administrador','soporte'))
  with check (public.mi_rol() in ('superadmin','administrador','soporte'));

-- ---------- cursos ----------
revoke insert, update, delete on public.cursos from anon, authenticated;
drop policy if exists "cursos_select" on public.cursos;
create policy "cursos_select" on public.cursos for select to authenticated using (true);

-- ---------- audit_log ----------
revoke insert, update, delete on public.audit_log from anon, authenticated;
drop policy if exists "audit_select" on public.audit_log;
create policy "audit_select" on public.audit_log for select to authenticated
  using (public.mi_rol() = 'superadmin');

-- Recomendado en Supabase > Authentication:
--  * Longitud mínima de contraseña >= 10 y "Leaked password protection" activada.
--  * Confirmación de correo obligatoria.
--  * Si usas políticas que dependan del MFA, añade:  and (auth.jwt()->>'aal') = 'aal2'
