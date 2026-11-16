import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ROLES, ESTADOS, ASSIGNABLE_ROLES, canManageUsers, normalizeRol } from '../lib/permissions';

const badgeEstado = (e) =>
  e === 'Activo' ? 'badge--ok' : e === 'Suspendido' ? 'badge--bad' : 'badge--warn';

export default function AdminUsers() {
  const { rol, user } = useAuth();
  const puedeEditar = canManageUsers(rol);
  const puedeEliminar = rol === 'superadmin';
  const asignables = ASSIGNABLE_ROLES[rol] || [];

  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,nombre,apellidos,rol,estado,programa,ambito,moodle_user_id,created_at')
      .order('created_at', { ascending: false });
    if (error) setErr(error.message);
    else setRows((data || []).map((r) => ({ ...r, rol: normalizeRol(r.rol) })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const valor = (r, campo) => {
    const d = drafts[r.id];
    if (d && d[campo] !== undefined) return d[campo];
    if (campo === 'ambito') return (r.ambito || []).join(', ');
    return r[campo] ?? '';
  };

  const cambiar = (id, campo, v) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [campo]: v } }));

  // Nadie edita su propia cuenta aquí; el Administrador no toca a Superadmin/Administrador
  const filaEditable = (r) => {
    if (!puedeEditar || r.id === user?.id) return false;
    if (rol === 'superadmin') return true;
    return !['superadmin', 'administrador'].includes(r.rol);
  };

  // Solo el Superadministrador elimina, y nunca a sí mismo ni a otro Superadministrador
  const filaEliminable = (r) => puedeEliminar && r.id !== user?.id && r.rol !== 'superadmin';

  const guardar = async (r) => {
    const d = drafts[r.id];
    if (!d) return;
    setSavingId(r.id);
    setMsg('');
    setErr('');

    const payload = {};
    if (d.rol !== undefined) payload.rol = d.rol;
    if (d.estado !== undefined) payload.estado = d.estado;
    if (d.programa !== undefined) payload.programa = d.programa.trim() || null;
    if (d.ambito !== undefined) {
      payload.ambito = d.ambito.split(',').map((s) => s.trim()).filter(Boolean);
    }

    try {
      const { perfil: data } = await api(`/api/users/${r.id}`, { method: 'PATCH', body: payload });
      if (!data) throw new Error('No se pudo actualizar: no tienes permiso sobre este usuario.');
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...data, rol: normalizeRol(data.rol) } : x)));
      setDrafts(({ [r.id]: _, ...resto }) => resto);
      setMsg('Cambios guardados.');
    } catch (e) {
      setErr(e.message);
    }
    setSavingId(null);
  };

  const eliminar = async (r) => {
    const quien = `${r.nombre || ''} ${r.apellidos || ''}`.trim() || r.email;
    const confirmado = window.confirm(
      `¿Eliminar definitivamente a ${quien}?\n\n` +
        'Se borrarán su cuenta, sus matrículas y sus trámites. En Moodle su cuenta se suspende para conservar sus calificaciones.\n\n' +
        'Esta acción no se puede deshacer.'
    );
    if (!confirmado) return;

    setSavingId(r.id);
    setMsg('');
    setErr('');
    try {
      const res = await api(`/api/users/${r.id}`, { method: 'DELETE' });
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      setDrafts(({ [r.id]: _, ...resto }) => resto);

      if (res.moodle === 'suspendida') {
        setMsg(`${quien} fue eliminado. Su cuenta de Moodle quedó suspendida.`);
      } else if (res.moodle === 'error') {
        setMsg(`${quien} fue eliminado, pero no se pudo suspender su cuenta de Moodle: ${res.moodle_aviso}`);
      } else {
        setMsg(`${quien} fue eliminado.`);
      }
    } catch (e) {
      setErr(e.message);
    }
    setSavingId(null);
  };

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.nombre, r.apellidos, r.email, r.rol, r.programa].filter(Boolean).join(' ').toLowerCase().includes(t)
    );
  }, [rows, q]);

  return (
    <div>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Buscar por nombre, correo, rol o programa…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="badge">{`${visibles.length} usuario(s)`}</span>
      </div>

      {msg && <div className="alert alert--ok">{msg}</div>}
      {err && <div className="alert alert--error">{err}</div>}

      {loading ? (
        <div className="empty">Cargando usuarios…</div>
      ) : visibles.length === 0 ? (
        <div className="empty">No hay usuarios dentro de tu ámbito.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Programa / ámbito</th>
                <th>ID Moodle</th>
                {puedeEditar && <th />}
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => {
                const editable = filaEditable(r);
                const rolActual = valor(r, 'rol') || r.rol;
                const opciones = asignables.includes(r.rol) ? asignables : [r.rol, ...asignables];
                const esCoord = rolActual === 'coordinador';

                return (
                  <tr key={r.id}>
                    <td className="who">
                      <strong>{`${r.nombre || ''} ${r.apellidos || ''}`.trim() || '—'}</strong>
                      <small>{r.email || '—'}</small>
                    </td>

                    <td>
                      {editable ? (
                        <select
                          className="select"
                          value={rolActual}
                          onChange={(e) => cambiar(r.id, 'rol', e.target.value)}
                        >
                          {opciones.map((k) => (
                            <option key={k} value={k}>{ROLES[k].label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="badge">{ROLES[r.rol]?.label || r.rol}</span>
                      )}
                    </td>

                    <td>
                      {editable ? (
                        <select
                          className="select"
                          value={valor(r, 'estado') || r.estado}
                          onChange={(e) => cambiar(r.id, 'estado', e.target.value)}
                        >
                          {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span className={`badge ${badgeEstado(r.estado)}`}>{r.estado}</span>
                      )}
                    </td>

                    <td>
                      {editable ? (
                        esCoord ? (
                          <input
                            className="input-sm"
                            placeholder="Programas separados por coma"
                            value={valor(r, 'ambito')}
                            onChange={(e) => cambiar(r.id, 'ambito', e.target.value)}
                          />
                        ) : (
                          <input
                            className="input-sm"
                            placeholder="Programa"
                            value={valor(r, 'programa')}
                            onChange={(e) => cambiar(r.id, 'programa', e.target.value)}
                          />
                        )
                      ) : r.rol === 'coordinador' ? (
                        (r.ambito || []).join(', ') || '—'
                      ) : (
                        r.programa || '—'
                      )}
                    </td>

                    <td>{r.moodle_user_id || '—'}</td>

                    {puedeEditar && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {editable && drafts[r.id] && (
                          <button
                            className="btn btn--primary btn--xs"
                            disabled={savingId === r.id}
                            onClick={() => guardar(r)}
                            style={{ marginRight: 8 }}
                          >
                            {savingId === r.id ? 'Guardando…' : 'Guardar'}
                          </button>
                        )}
                        {filaEliminable(r) && (
                          <button
                            className="btn btn--danger btn--xs"
                            disabled={savingId === r.id}
                            onClick={() => eliminar(r)}
                          >
                            Eliminar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="hint">
        {puedeEditar
          ? 'Solo puedes asignar roles dentro de tu autorización. El ID de Moodle lo registra el backend al sincronizar.'
          : 'Vista de solo lectura, limitada a tu ámbito.'}
        {puedeEliminar && ' Para quitar el acceso de forma reversible, usa el estado Suspendido en lugar de Eliminar.'}
      </p>
    </div>
  );
}
