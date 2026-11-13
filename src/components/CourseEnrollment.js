import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ROLES, canManageUsers } from '../lib/permissions';

const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX') : '—');
const nombreDe = (u) => `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email;

export default function CourseEnrollment({ onNavigate }) {
  const { rol, can } = useAuth();
  const puede = canManageUsers(rol);

  const [pend, setPend] = useState([]);
  const [sinMat, setSinMat] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');

    const [p, a, m] = await Promise.all([
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
    ]);

    if (p.error) setErr(p.error.message);
    else setPend(p.data || []);

    if (!a.error && !m.error) {
      const conMatricula = new Set((m.data || []).map((x) => x.user_id));
      setSinMat((a.data || []).filter((u) => !conMatricula.has(u.id)));
    }
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
          ? 'Al autorizar, el usuario pasa a estado Activo con el rol y el programa elegidos. Después se le matricula en Mis cursos.'
          : 'Vista de solo lectura, limitada a tu ámbito.'}
      </p>
    </div>
  );
}
