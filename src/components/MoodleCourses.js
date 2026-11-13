import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';

export default function MoodleCourses() {
  const [estado, setEstado] = useState(null);
  const [cursos, setCursos] = useState([]);
  const [sel, setSel] = useState({});
  const [programa, setPrograma] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [st, lista] = await Promise.all([api('/api/moodle/status'), api('/api/moodle/courses')]);
      setEstado(st);
      setCursos(lista);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const importar = async () => {
    const elegidos = cursos.filter((c) => sel[c.id]).map((c) => ({ id: c.id, nombre: c.nombre }));
    if (elegidos.length === 0) return;

    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const r = await api('/api/moodle/import-courses', {
        method: 'POST',
        body: { cursos: elegidos, programa: programa.trim() || null },
      });
      setMsg(`${r.importados} curso(s) importado(s).`);
      setSel({});
      load();
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  const seleccionados = Object.values(sel).filter(Boolean).length;

  return (
    <div>
      {estado && (
        <div className="alert alert--ok">
          Conectado a <strong>{estado.sitio}</strong> (Moodle {estado.version}) con la cuenta {estado.usuario}.
        </div>
      )}
      {msg && <div className="alert alert--ok">{msg}</div>}
      {err && <div className="alert alert--error">{err}</div>}

      {loading ? (
        <div className="empty">Consultando Moodle…</div>
      ) : cursos.length === 0 && !err ? (
        <div className="empty">Moodle no tiene cursos todavía. Crea uno en Moodle y vuelve a esta pantalla.</div>
      ) : cursos.length > 0 ? (
        <>
          <div className="enroll-form">
            <div>
              <label htmlFor="prog">Programa al que pertenecen los cursos elegidos</label>
              <input
                id="prog"
                className="input-sm"
                style={{ width: '100%', padding: '12px 10px' }}
                placeholder="Ej. Ingeniería Informática"
                value={programa}
                onChange={(e) => setPrograma(e.target.value)}
              />
            </div>
            <span />
            <button className="btn btn--primary" disabled={saving || seleccionados === 0} onClick={importar}>
              {saving ? 'Importando…' : `Importar (${seleccionados})`}
            </button>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>ID Moodle</th>
                  <th>Curso</th>
                  <th>Visible</th>
                  <th>En el portal</th>
                </tr>
              </thead>
              <tbody>
                {cursos.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={c.importado}
                        checked={!!sel[c.id]}
                        onChange={(e) => setSel({ ...sel, [c.id]: e.target.checked })}
                      />
                    </td>
                    <td>{c.id}</td>
                    <td className="who">
                      <strong>{c.nombre}</strong>
                      <small>{c.corto}</small>
                    </td>
                    <td>{c.visible ? 'Sí' : 'No'}</td>
                    <td>
                      <span className={`badge ${c.importado ? 'badge--ok' : 'badge--warn'}`}>
                        {c.importado ? 'Importado' : 'Sin importar'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <p className="hint">Solo se importan los datos del curso; los usuarios se vinculan al matricular.</p>
    </div>
  );
}
