import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../lib/permissions';

const CATALOGO = [
  { id: 'TRM-01', titulo: 'Constancia de estudios con calificaciones', costo: '$50.00 MXN', entrega: '24 horas hábiles', roles: ['estudiante'] },
  { id: 'TRM-02', titulo: 'Historial académico oficial (Kardex)', costo: '$80.00 MXN', entrega: 'Inmediato (digital)', roles: ['estudiante'] },
  { id: 'TRM-03', titulo: 'Reposición de credencial escolar', costo: '$120.00 MXN', entrega: '3 días hábiles', roles: ['estudiante', 'profesor'] },
  { id: 'TRM-04', titulo: 'Constancia de inscripción', costo: 'Sin costo', entrega: 'Inmediato (digital)', roles: ['estudiante'] },
  { id: 'TRM-05', titulo: 'Actualización de datos personales', costo: 'Sin costo', entrega: '2 días hábiles', roles: ['estudiante', 'profesor', 'aspirante', 'coordinador'] },
];

const ESTADOS_TRAMITE = ['Solicitado', 'En proceso', 'Entregado', 'Rechazado'];

const tonoTramite = (e) =>
  e === 'Entregado' ? 'badge--ok' : e === 'Rechazado' ? 'badge--bad' : e === 'En proceso' ? '' : 'badge--warn';

const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX') : '—');
const nombreDe = (u) => (u ? `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email : '—');

export default function SchoolServices() {
  const { rol, user, profile } = useAuth();
  const atiende = ['superadmin', 'administrador', 'soporte'].includes(rol);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Solicitante
  const [abierto, setAbierto] = useState(null);
  const [detalle, setDetalle] = useState('');
  const [saving, setSaving] = useState(false);

  // Atención
  const [filtro, setFiltro] = useState('abiertos');
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    const { data, error } = await supabase
      .from('tramites')
      .select('id,tipo,detalle,estado,respuesta,created_at,usuario:profiles(nombre,apellidos,email,rol)')
      .order('created_at', { ascending: false });
    if (error) setErr(error.message);
    else setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ---------- Solicitante ---------- */
  const tiposAbiertos = useMemo(
    () => new Set(rows.filter((r) => ['Solicitado', 'En proceso'].includes(r.estado)).map((r) => r.tipo)),
    [rows]
  );

  const catalogo = CATALOGO.filter((c) => c.roles.includes(rol));

  const solicitar = async (e) => {
    e.preventDefault();
    const item = CATALOGO.find((c) => c.id === abierto);
    if (!item) return;

    setSaving(true);
    setMsg('');
    setErr('');
    const { error } = await supabase
      .from('tramites')
      .insert([{ user_id: user.id, tipo: item.titulo, detalle: detalle.trim() || null }]);

    if (error) setErr(error.message);
    else {
      setMsg('Solicitud enviada. Podrás seguir su estado en "Mis solicitudes".');
      setAbierto(null);
      setDetalle('');
      load();
    }
    setSaving(false);
  };

  /* ---------- Atención ---------- */
  const valor = (r, campo) => {
    const d = drafts[r.id];
    if (d && d[campo] !== undefined) return d[campo];
    return r[campo] ?? '';
  };

  const cambiar = (id, campo, v) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [campo]: v } }));

  const guardar = async (r) => {
    const d = drafts[r.id];
    if (!d) return;

    setSavingId(r.id);
    setMsg('');
    setErr('');

    const payload = {};
    if (d.estado !== undefined) payload.estado = d.estado;
    if (d.respuesta !== undefined) payload.respuesta = d.respuesta.trim() || null;

    const { data, error } = await supabase
      .from('tramites')
      .update(payload)
      .eq('id', r.id)
      .select('id,estado,respuesta')
      .maybeSingle();

    if (error) setErr(error.message);
    else if (!data) setErr('No se pudo actualizar: no tienes permiso sobre esta solicitud.');
    else {
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...data } : x)));
      setDrafts(({ [r.id]: _, ...resto }) => resto);
      setMsg('Solicitud actualizada.');
    }
    setSavingId(null);
  };

  const visibles = rows.filter((r) => {
    if (filtro === 'todos') return true;
    if (filtro === 'abiertos') return ['Solicitado', 'En proceso'].includes(r.estado);
    return r.estado === filtro;
  });

  if (loading) return <div className="empty">Cargando trámites…</div>;

  /* =================== VISTA DE ATENCIÓN =================== */
  if (atiende) {
    return (
      <div>
        {msg && <div className="alert alert--ok">{msg}</div>}
        {err && <div className="alert alert--error">{err}</div>}

        <div className="toolbar">
          <select className="select" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="abiertos">Abiertos (Solicitado y En proceso)</option>
            <option value="todos">Todos</option>
            {ESTADOS_TRAMITE.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="badge">{`${visibles.length} solicitud(es)`}</span>
        </div>

        {visibles.length === 0 ? (
          <div className="empty">No hay solicitudes con ese filtro.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Solicitante</th>
                  <th>Trámite</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Respuesta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => (
                  <tr key={r.id}>
                    <td className="who">
                      <strong>{nombreDe(r.usuario)}</strong>
                      <small>{r.usuario?.email || ''}</small>
                    </td>
                    <td className="who">
                      <strong>{r.tipo}</strong>
                      {r.detalle && <small>{r.detalle}</small>}
                    </td>
                    <td>{fecha(r.created_at)}</td>
                    <td>
                      <select
                        className="select"
                        value={valor(r, 'estado')}
                        onChange={(e) => cambiar(r.id, 'estado', e.target.value)}
                      >
                        {ESTADOS_TRAMITE.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input-sm"
                        placeholder="Mensaje para el solicitante"
                        value={valor(r, 'respuesta')}
                        onChange={(e) => cambiar(r.id, 'respuesta', e.target.value)}
                      />
                    </td>
                    <td>
                      {drafts[r.id] && (
                        <button
                          className="btn btn--primary btn--xs"
                          disabled={savingId === r.id}
                          onClick={() => guardar(r)}
                        >
                          {savingId === r.id ? 'Guardando…' : 'Guardar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="hint">
          {rol === 'soporte'
            ? 'Como Soporte atiendes solicitudes de estudiantes y aspirantes, sin privilegios académicos.'
            : 'Aquí atiendes las solicitudes de trámites de los usuarios.'}
        </p>
      </div>
    );
  }

  /* =================== VISTA DEL SOLICITANTE =================== */
  return (
    <div>
      <div className="dash-head">
        <div>
          <h2>Trámites y servicios</h2>
          <p>
            Solicitante: <strong>{profile?.nombre} {profile?.apellidos}</strong> · {ROLES[rol]?.label}
            {profile?.programa ? ` · ${profile.programa}` : ''}
          </p>
        </div>
      </div>

      {msg && <div className="alert alert--ok">{msg}</div>}
      {err && <div className="alert alert--error">{err}</div>}

      <div className="dash-section">
        <h3>Solicitar un trámite</h3>
        {catalogo.length === 0 ? (
          <div className="empty">Tu rol no tiene trámites disponibles por ahora.</div>
        ) : (
          <div className="service-list">
            {catalogo.map((c) => {
              const yaAbierto = tiposAbiertos.has(c.titulo);
              return (
                <div className="service-item" key={c.id}>
                  <div className="service-item__top">
                    <div>
                      <span className="service-code">{c.id}</span>
                      <h4>{c.titulo}</h4>
                      <small>Costo: <strong>{c.costo}</strong> · Tiempo de entrega: {c.entrega}</small>
                    </div>
                    {yaAbierto ? (
                      <span className="badge badge--warn">Solicitud abierta</span>
                    ) : (
                      <button
                        className="btn btn--primary btn--xs"
                        onClick={() => { setAbierto(abierto === c.id ? null : c.id); setDetalle(''); }}
                      >
                        {abierto === c.id ? 'Cancelar' : 'Solicitar'}
                      </button>
                    )}
                  </div>

                  {abierto === c.id && (
                    <form className="request-form" onSubmit={solicitar}>
                      <label htmlFor={`det-${c.id}`}>Detalles (opcional)</label>
                      <textarea
                        id={`det-${c.id}`}
                        className="textarea"
                        placeholder="Agrega cualquier dato que ayude a atender tu solicitud"
                        value={detalle}
                        onChange={(e) => setDetalle(e.target.value)}
                      />
                      <div>
                        <button className="btn btn--primary btn--sm" disabled={saving}>
                          {saving ? 'Enviando…' : 'Enviar solicitud'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="dash-section" style={{ marginTop: 32 }}>
        <h3>Mis solicitudes</h3>
        {rows.length === 0 ? (
          <div className="empty">Aún no has solicitado ningún trámite.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Trámite</th><th>Fecha</th><th>Estado</th><th>Respuesta</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="who">
                      <strong>{r.tipo}</strong>
                      {r.detalle && <small>{r.detalle}</small>}
                    </td>
                    <td>{fecha(r.created_at)}</td>
                    <td><span className={`badge ${tonoTramite(r.estado)}`}>{r.estado}</span></td>
                    <td>{r.respuesta || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
