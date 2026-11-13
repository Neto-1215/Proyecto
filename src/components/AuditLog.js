import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const fmt = (v) =>
  v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') || '—' : String(v);

const cambios = (antes = {}, despues = {}) =>
  Object.keys(despues || {})
    .filter((k) => JSON.stringify(antes?.[k]) !== JSON.stringify(despues[k]))
    .map((k) => `${k}: ${fmt(antes?.[k])} → ${fmt(despues[k])}`)
    .join(' · ');

const detalle = (r) => {
  if (r.accion === 'usuario_registrado') return 'Nuevo registro (Aspirante · Pendiente)';
  if (r.accion === 'usuario_eliminado') {
    const a = r.antes || {};
    return `Usuario eliminado: ${a.email || '—'} (${a.rol || '—'})${a.moodle === 'suspendida' ? ' · cuenta de Moodle suspendida' : ''}`;
  }
  return cambios(r.antes, r.despues);
};

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [quien, setQuien] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const a = await supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (a.error) {
        setErr(a.error.message);
        setLoading(false);
        return;
      }
      setRows(a.data || []);

      const p = await supabase.from('profiles').select('id,email,nombre');
      if (!p.error) {
        setQuien(Object.fromEntries((p.data || []).map((x) => [x.id, x.email || x.nombre])));
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="empty">Cargando auditoría…</div>;
  if (err) return <div className="alert alert--error">{err}</div>;
  if (rows.length === 0) return <div className="empty">Aún no hay cambios registrados.</div>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Quién</th>
            <th>Usuario afectado</th>
            <th>Cambios</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleString('es-MX')}</td>
              <td>
                {quien[r.actor] || (r.actor ? r.actor.slice(0, 8) : 'Sistema')}
                {r.actor_rol && (
                  <small style={{ display: 'block', color: '#4b5563' }}>{r.actor_rol}</small>
                )}
              </td>
              <td>{quien[r.objetivo] || r.antes?.email || (r.objetivo || '').slice(0, 8)}</td>
              <td>{detalle(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
