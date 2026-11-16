import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { abrirCampus } from '../lib/campus';
import { useAuth } from '../context/AuthContext';
import { canManageEnrollments } from '../lib/permissions';

const MOODLE_URL = process.env.REACT_APP_MOODLE_URL;

const badgeMoodle = (e) =>
  e === 'Sincronizada' ? 'badge--ok' : e === 'Error' ? 'badge--bad' : 'badge--warn';

export default function CourseAccess() {
  const { rol } = useAuth();
  const gestiona = canManageEnrollments(rol);
  const verTabla = ['superadmin', 'administrador', 'coordinador'].includes(rol);
  const esEstudiante = rol === 'estudiante';

  const [mats, setMats] = useState([]);
  const [cursos, setCursos] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [sel, setSel] = useState({ user: '', curso: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Calificaciones (solo vista de estudiante)
  const [grades, setGrades] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');

    const m = await supabase
      .from('matriculas')
      .select(
        'id,rol_moodle,estado,moodle_estado,moodle_error,created_at,' +
          'curso:cursos(id,nombre,programa,moodle_course_id),' +
          'usuario:profiles(id,nombre,apellidos,email,rol)'
      )
      .order('created_at', { ascending: false });
    if (m.error) setErr(m.error.message);
    else setMats(m.data || []);

    if (gestiona) {
      const [c, p] = await Promise.all([
        supabase.from('cursos').select('id,nombre,programa').eq('activo', true).order('nombre'),
        supabase
          .from('profiles')
          .select('id,nombre,apellidos,email,rol')
          .in('rol', ['estudiante', 'profesor'])
          .eq('estado', 'Activo')
          .order('nombre'),
      ]);
      if (!c.error) setCursos(c.data || []);
      if (!p.error) setPersonas(p.data || []);
    }
    setLoading(false);
  }, [gestiona]);

  useEffect(() => { load(); }, [load]);

  /* ---------- Calificaciones del alumno, una vez cargadas sus matrículas ---------- */
  useEffect(() => {
    if (!esEstudiante) return;
    mats.forEach((m) => {
      if (m.moodle_estado === 'Sincronizada' && m.curso?.moodle_course_id && grades[m.id] === undefined) {
        setGrades((g) => ({ ...g, [m.id]: 'cargando' }));
        api(`/api/moodle/grade/${m.id}`)
          .then((d) => setGrades((g) => ({ ...g, [m.id]: d.calificacion || 'Aún sin calificar' })))
          .catch(() => setGrades((g) => ({ ...g, [m.id]: 'No disponible' })));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mats, esEstudiante]);

  const matricular = async (e) => {
    e.preventDefault();
    const persona = personas.find((p) => p.id === sel.user);
    if (!persona || !sel.curso) return;

    setSaving(true);
    setMsg('');
    setErr('');

    const rol_moodle = persona.rol === 'profesor' ? 'teacher' : 'student';
    const { data: nueva, error } = await supabase
      .from('matriculas')
      .insert([{ user_id: persona.id, curso_id: sel.curso, rol_moodle }])
      .select('id')
      .single();

    if (error) {
      setErr(error.code === '23505' ? 'Ese usuario ya está matriculado en el curso.' : error.message);
    } else {
      try {
        await api('/api/moodle/enrol', { method: 'POST', body: { matricula_id: nueva.id } });
        setMsg('Matrícula registrada y sincronizada con Moodle.');
      } catch (e2) {
        setErr(`La matrícula se guardó, pero no se pudo sincronizar con Moodle: ${e2.message}`);
      }
      setSel({ user: '', curso: '' });
      load();
    }
    setSaving(false);
  };

  const reintentar = async (id) => {
    setBusyId(id);
    setMsg('');
    setErr('');
    try {
      await api('/api/moodle/enrol', { method: 'POST', body: { matricula_id: id } });
      setMsg('Sincronizada con Moodle.');
    } catch (e) {
      setErr(e.message);
    }
    setBusyId(null);
    load();
  };

  const quitar = async (id) => {
    if (!window.confirm('¿Quitar esta matrícula? También se quitará en Moodle.')) return;
    setBusyId(id);
    setMsg('');
    setErr('');
    try {
      await api('/api/moodle/unenrol', { method: 'POST', body: { matricula_id: id } });
      setMats((ms) => ms.filter((x) => x.id !== id));
      setMsg('Matrícula eliminada.');
    } catch (e) {
      setErr(e.message);
    }
    setBusyId(null);
  };

  const entrar = async (id) => {
    setBusyId(id);
    setMsg('');
    setErr('');
    try {
      await abrirCampus(id);
    } catch (e) {
      setErr(e.message);
    }
    setBusyId(null);
  };

  const nombre = (u) =>
    u ? `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email : 'Fuera de tu ámbito';

  if (loading) return <div className="empty">Cargando cursos…</div>;

  return (
    <div>
      {msg && <div className="alert alert--ok">{msg}</div>}
      {err && <div className="alert alert--error">{err}</div>}

      {gestiona && (
        <form className="enroll-form" onSubmit={matricular}>
          <div>
            <label htmlFor="persona">Usuario (Estudiante o Profesor activo)</label>
            <select
              id="persona"
              className="select"
              required
              value={sel.user}
              onChange={(e) => setSel({ ...sel, user: e.target.value })}
            >
              <option value="">Selecciona…</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {nombre(p)} · {p.rol === 'profesor' ? 'Profesor' : 'Estudiante'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="curso">Curso autorizado</label>
            <select
              id="curso"
              className="select"
              required
              value={sel.curso}
              onChange={(e) => setSel({ ...sel, curso: e.target.value })}
            >
              <option value="">Selecciona…</option>
              {cursos.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
          <button className="btn btn--primary" disabled={saving}>
            {saving ? 'Matriculando…' : 'Matricular'}
          </button>
        </form>
      )}

      {mats.length === 0 ? (
        <div className="empty">
          {verTabla
            ? 'No hay matrículas dentro de tu ámbito.'
            : 'Aún no tienes cursos asignados. Tu acceso depende de una matrícula autorizada.'}
        </div>
      ) : verTabla ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Curso</th>
                <th>Rol en Moodle</th>
                <th>Moodle</th>
                {gestiona && <th />}
              </tr>
            </thead>
            <tbody>
              {mats.map((m) => (
                <tr key={m.id}>
                  <td className="who">
                    <strong>{nombre(m.usuario)}</strong>
                    <small>{m.usuario?.email || ''}</small>
                  </td>
                  <td>{m.curso?.nombre || '—'}</td>
                  <td>
                    <span className="badge">{m.rol_moodle === 'teacher' ? 'Teacher' : 'Student'}</span>
                  </td>
                  <td>
                    <span className={`badge ${badgeMoodle(m.moodle_estado)}`} title={m.moodle_error || ''}>
                      {m.moodle_estado}
                    </span>
                  </td>
                  {gestiona && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {m.moodle_estado !== 'Sincronizada' && (
                        <button
                          className="btn btn--primary btn--xs"
                          disabled={busyId === m.id}
                          onClick={() => reintentar(m.id)}
                          style={{ marginRight: 8 }}
                        >
                          {busyId === m.id ? '…' : 'Sincronizar'}
                        </button>
                      )}
                      <button
                        className="btn btn--light btn--xs"
                        disabled={busyId === m.id}
                        onClick={() => quitar(m.id)}
                      >
                        Quitar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="course-grid">
          {mats.map((m) => (
            <article className="course-card" key={m.id}>
              <span className="badge">{m.rol_moodle === 'teacher' ? 'Profesor del curso' : 'Estudiante'}</span>
              <h3>{m.curso?.nombre}</h3>
              <p>{m.curso?.programa || 'Sin programa'}</p>

              {esEstudiante && (
                <p style={{ margin: '4px 0 12px' }}>
                  Calificación:{' '}
                  <strong>
                    {grades[m.id] === undefined || grades[m.id] === 'cargando' ? 'Cargando…' : grades[m.id]}
                  </strong>
                </p>
              )}

              {MOODLE_URL && m.curso?.moodle_course_id && m.moodle_estado === 'Sincronizada' ? (
                <button
                  className="btn btn--primary btn--xs"
                  disabled={busyId === m.id}
                  onClick={() => entrar(m.id)}
                >
                  {busyId === m.id ? 'Abriendo…' : 'Acceder al campus'}
                </button>
              ) : (
                <button className="btn btn--light btn--xs" disabled>
                  {m.moodle_estado === 'Sincronizada' ? 'Campus no configurado' : 'Acceso en proceso'}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}