import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ROLES, canManageUsers } from '../lib/permissions';

const TIPO_INSCRIPCION = 'Inscripción a curso';

const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX') : '—');
const nombreDe = (u) => `${u?.nombre || ''} ${u?.apellidos || ''}`.trim() || u?.email || '—';
const dinero = (n) => (n != null ? `$${Number(n).toFixed(2)} MXN` : null);

export default function CourseEnrollment({ onNavigate }) {
  const { rol, can } = useAuth();
  const puede = canManageUsers(rol);

  const [pend, setPend] = useState([]);
  const [sinMat, setSinMat] = useState([]);
  const [solCursos, setSolCursos] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [busyCursoId, setBusyCursoId] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');

    const [p, a, m, sc] = await Promise.all([
      supabase
        .from('profiles')
        .select('id,nombre,apellidos,email,rol,programa,created_at')
        .eq('estado', 'Pendiente')
        .order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id,nombre,apellidos,email,rol,programa')
        .eq('estado', 'Activo')
        .in('rol', ['estudiante', 'profesor'])
        .order('nombre'),
      supabase.from('matriculas').select('user_id'),
      supabase
        .from('tramites')
        .select('id,detalle,created_at,curso_id,monto,usuario:profiles(id,nombre,apellidos,email,rol,estado),curso:cursos(id,nombre,moodle_course_id,precio)')
        .eq('tipo', TIPO_INSCRIPCION)
        .in('estado', ['Solicitado', 'En proceso'])
        .order('created_at', { ascending: false }),
    ]);

    if (p.error) setErr(p.error.message);
    else setPend(p.data || []);

    if (!a.error && !m.error) {
      const conMatricula = new Set((m.data || []).map((x) => x.user_id));
      setSinMat((a.data || []).filter((u) => !conMatricula.has(u.id)));
    }

    if (sc.error) setErr(sc.error.message);
    else setSolCursos(sc.data || []);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const valor = (u, campo) => {
    const d = drafts[u.id];
    if (d && d[campo] !== undefined) return d[campo];
    if (campo === 'rol') return 'estudiante';
    return u[campo] || '';
  };

  const cambiar = (id, campo, v) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [campo]: v } }));

  const autorizar = async (u) => {
    const rolNuevo = valor(u, 'rol');
    const programa = String(valor(u, 'programa')).trim();
    if (!programa) {
      setErr('Escribe el programa antes de autorizar la solicitud.');
      return;
    }

    setBusyId(u.id);
    setMsg('');
    setErr('');
    const { data, error } = await supabase
      .from('profiles')
      .update({ rol: rolNuevo, estado: 'Activo', programa })
      .eq('id', u.id)
      .select('id')
      .maybeSingle();

    if (error) setErr(error.message);
    else if (!data) setErr('No se pudo autorizar: no tienes permiso sobre este usuario.');
    else {
      setMsg(`${nombreDe(u)} fue autorizado como ${ROLES[rolNuevo].label}. Ya puedes matricularlo en un curso.`);
      load();
    }
    setBusyId(null);
  };

  const rechazar = async (u) => {
    if (!window.confirm(`¿Rechazar la solicitud de ${nombreDe(u)}? Su cuenta quedará suspendida.`)) return;
    setBusyId(u.id);
    setMsg('');
    setErr('');
    const { data, error } = await supabase
      .from('profiles')
      .update({ estado: 'Suspendido' })
      .eq('id', u.id)
      .select('id')
      .maybeSingle();

    if (error) setErr(error.message);
    else if (!data) setErr('No se pudo rechazar: no tienes permiso sobre este usuario.');
    else {
      setMsg('Solicitud rechazada.');
      load();
    }
    setBusyId(null);
  };

  /* ---------- Solicitudes de inscripción pagada ---------- */
  const aprobarInscripcion = async (s) => {
    if (s.usuario?.estado !== 'Activo') {
      setErr('Primero autoriza la cuenta de este usuario en "Solicitudes de admisión".');
      return;
    }
    if (!s.curso?.id) {
      setErr('El curso de esta solicitud ya no existe. Rechaza la solicitud.');
      return;
    }

    setBusyCursoId(s.id);
    setMsg('');
    setErr('');

    const rol_moodle = s.usuario.rol === 'profesor' ? 'teacher' : 'student';
    const { data: nueva, error } = await supabase
      .from('matriculas')
      .insert([{ user_id: s.usuario.id, curso_id: s.curso.id, rol_moodle }])
      .select('id')
      .single();

    let matriculaId = nueva?.id;

    if (error) {
      if (error.code === '23505') {
        // Ya estaba matriculado: toma la matrícula existente para sincronizarla
        const existente = await supabase
          .from('matriculas')
          .select('id')
          .eq('user_id', s.usuario.id)
          .eq('curso_id', s.curso.id)
          .maybeSingle();
        matriculaId = existente.data?.id;
      } else {
        setErr(error.message);
        setBusyCursoId(null);
        return;
      }
    }

    let avisoMoodle = '';
    if (matriculaId) {
      try {
        await api('/api/moodle/enrol', { method: 'POST', body: { matricula_id: matriculaId } });
      } catch (e) {
        avisoMoodle = ` (la matrícula se guardó, pero no se sincronizó con Moodle: ${e.message}. Puedes reintentarlo en "Mis cursos")`;
      }
    }

    const { error: errTramite } = await supabase
      .from('tramites')
      .update({ estado: 'Entregado', respuesta: 'Acceso otorgado al curso.' })
      .eq('id', s.id);
    if (errTramite) setErr(errTramite.message);

    setMsg(`Se otorgó acceso de ${nombreDe(s.usuario)} al curso "${s.curso.nombre}".${avisoMoodle}`);
    setBusyCursoId(null);
    load();
  };

  const rechazarInscripcion = async (s) => {
    if (!window.confirm(`¿Rechazar la solicitud de inscripción de ${nombreDe(s.usuario)}?`)) return;
    setBusyCursoId(s.id);
    setMsg('');
    setErr('');
    const { error } = await supabase
      .from('tramites')
      .update({ estado: 'Rechazado', respuesta: 'Solicitud de inscripción rechazada.' })
      .eq('id', s.id);

    if (error) setErr(error.message);
    else {
      setMsg('Solicitud de inscripción rechazada.');
      load();
    }
    setBusyCursoId(null);
  };

  if (loading) return <div className="empty">Cargando solicitudes…</div>;

  return (
    <div>
      {msg && <div className="alert alert--ok">{msg}</div>}
      {err && <div className="alert alert--error">{err}</div>}

      <div className="dash-section">
        <h3>Solicitudes de admisión</h3>
        {pend.length === 0 ? (
          <div className="empty">No hay solicitudes pendientes dentro de tu ámbito.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Solicitante</th>
                  <th>Registro</th>
                  <th>Asignar como</th>
                  <th>Programa</th>
                  {puede && <th />}
                </tr>
              </thead>
              <tbody>
                {pend.map((u) => (
                  <tr key={u.id}>
                    <td className="who">
                      <strong>{nombreDe(u)}</strong>
                      <small>{u.email}</small>
                    </td>
                    <td>{fecha(u.created_at)}</td>
                    <td>
                      {puede ? (
                        <select
                          className="select"
                          value={valor(u, 'rol')}
                          onChange={(e) => cambiar(u.id, 'rol', e.target.value)}
                        >
                          <option value="estudiante">Estudiante</option>
                          <option value="profesor">Profesor</option>
                        </select>
                      ) : (
                        <span className="badge">{ROLES[u.rol]?.label || u.rol}</span>
                      )}
                    </td>
                    <td>
                      {puede ? (
                        <input
                          className="input-sm"
                          placeholder="Ej. Ingeniería Informática"
                          value={valor(u, 'programa')}
                          onChange={(e) => cambiar(u.id, 'programa', e.target.value)}
                        />
                      ) : (
                        u.programa || '—'
                      )}
                    </td>
                    {puede && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn btn--primary btn--xs"
                          disabled={busyId === u.id}
                          onClick={() => autorizar(u)}
                          style={{ marginRight: 8 }}
                        >
                          {busyId === u.id ? '…' : 'Autorizar'}
                        </button>
                        <button
                          className="btn btn--light btn--xs"
                          disabled={busyId === u.id}
                          onClick={() => rechazar(u)}
                        >
                          Rechazar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="dash-section" style={{ marginTop: 32 }}>
        <h3>Solicitudes de inscripción pagada</h3>
        {solCursos.length === 0 ? (
          <div className="empty">No hay solicitudes de inscripción pendientes.</div>
        ) : (
          <ul className="pending-list">
            {solCursos.map((s) => {
              const costo = dinero(s.monto ?? s.curso?.precio);
              return (
                <li key={s.id}>
                  <div>
                    <strong>{nombreDe(s.usuario)}</strong>
                    <small>
                      {s.usuario?.email} · solicita <strong>{s.curso?.nombre || s.detalle || 'curso eliminado'}</strong>
                      {costo && <> · a pagar: <strong>{costo}</strong></>}
                      {' '}· {fecha(s.created_at)}
                    </small>
                  </div>
                  {puede ? (
                    <div style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn--primary btn--xs"
                        disabled={busyCursoId === s.id}
                        onClick={() => aprobarInscripcion(s)}
                      >
                        {busyCursoId === s.id ? '…' : 'Aprobar y matricular'}
                      </button>
                      <button
                        className="btn btn--light btn--xs"
                        disabled={busyCursoId === s.id}
                        onClick={() => rechazarInscripcion(s)}
                      >
                        Rechazar
                      </button>
                    </div>
                  ) : (
                    <span className="badge badge--warn">Pendiente</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="dash-section" style={{ marginTop: 32 }}>
        <h3>Autorizados sin matrícula</h3>
        {sinMat.length === 0 ? (
          <div className="empty">Todos los usuarios autorizados ya tienen al menos un curso.</div>
        ) : (
          <>
            <ul className="pending-list">
              {sinMat.map((u) => (
                <li key={u.id}>
                  <div>
                    <strong>{nombreDe(u)}</strong>
                    <small>{u.email} · {u.programa || 'Sin programa'}</small>
                  </div>
                  <span className="badge">{ROLES[u.rol]?.label || u.rol}</span>
                </li>
              ))}
            </ul>
            {puede && can('courses') && onNavigate && (
              <p style={{ marginTop: 16 }}>
                <button className="btn btn--primary btn--sm" onClick={() => onNavigate('courses')}>
                  Ir a matricular en Mis cursos
                </button>
              </p>
            )}
          </>
        )}
      </div>

      <p className="hint">
        {puede
          ? 'Al autorizar, el usuario pasa a estado Activo con el rol y el programa elegidos. Al aprobar una inscripción pagada, se le matricula y se sincroniza con Moodle automáticamente.'
          : 'Vista de solo lectura, limitada a tu ámbito.'}
      </p>
    </div>
  );
}
