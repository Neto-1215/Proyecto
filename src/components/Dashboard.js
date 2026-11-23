import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../lib/permissions';
import { obtenerAccesoCampus, irACampus } from '../lib/campus';
import Icon from './Icon';

const MOODLE_URL = process.env.REACT_APP_MOODLE_URL;
// Foto opcional del campus: colócala en public/campus.jpg. Si no existe, se muestra la ilustración.
const FOTO_CAMPUS = `${process.env.PUBLIC_URL || ''}/campus.jpg`;

const claseEstado = (e) =>
  e === 'Activo' ? 'status--ok' : e === 'Suspendido' ? 'status--bad' : 'status--warn';

const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX') : '—');

/* ---------- Banner "Mi IINICIA" ---------- */
function HeroBanner() {
  const [foto, setFoto] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setFoto(true);
    img.src = FOTO_CAMPUS;
  }, []);

  return (
    <section
      className={`hero-banner ${foto ? 'has-photo' : ''}`}
      style={foto ? { '--foto': `url(${FOTO_CAMPUS})` } : undefined}
    >
      <div className="hero-banner__text">
        <h1>Mi <span>IINICIA</span></h1>
        <p>Tu panel personal con tu actividad y tu avance.</p>
        <span className="hero-banner__bar" />
      </div>

      {/* Motivo del infinito: la marca del instituto */}
      <svg className="hero-banner__art" viewBox="0 0 560 200" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="bn-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0f6fef" />
            <stop offset="1" stopColor="#3bb4f2" />
          </linearGradient>
        </defs>
        <path
          d="M280 100C240 40 150 20 100 56c-44 32-44 76 0 88 50 14 140-8 180-44 40-36 130-58 180-44 44 12 44 56 0 88-50 36-140 16-180-44z"
          stroke="url(#bn-g)" strokeWidth="2" opacity=".35"
        />
        <path
          d="M280 100C240 52 170 36 128 62c-34 22-34 54 0 66 40 12 110-6 152-28 42-22 112-40 152-28 34 12 34 44 0 66-42 26-112 10-152-38z"
          stroke="url(#bn-g)" strokeWidth="3" opacity=".6"
        />
        <path
          d="M280 100C246 64 190 52 156 72c-24 14-24 38 0 46 30 10 88-4 124-18 36-14 94-28 124-18 24 8 24 32 0 46-34 20-90 8-124-28z"
          stroke="url(#bn-g)" strokeWidth="5" opacity=".9"
        />
        <circle cx="280" cy="100" r="7" fill="#0f6fef" />
      </svg>
    </section>
  );
}

/* ---------- Ilustración de "todo al día" ---------- */
function EmptyArt() {
  return (
    <svg viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <circle cx="48" cy="48" r="44" fill="#e3f0ff" />
      <rect x="26" y="22" width="44" height="54" rx="8" fill="#fff" stroke="#0f6fef" strokeWidth="3" />
      <path d="M36 38h24M36 48h24M36 58h12" stroke="#9cc4f7" strokeWidth="3" strokeLinecap="round" />
      <circle cx="66" cy="68" r="13" fill="#12b76a" />
      <path d="m60 68 4 4 8-8" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Dashboard({ onNavigate }) {
  const { profile, rol, estado, can } = useAuth();

  const esAlumno = rol === 'estudiante' || rol === 'profesor';
  const esAspirante = rol === 'aspirante';
  const esStaff = ['superadmin', 'administrador', 'coordinador', 'soporte'].includes(rol);
  const esAdmin = ['superadmin', 'administrador'].includes(rol);

  const [loading, setLoading] = useState(true);
  const [mats, setMats] = useState([]);
  const [stats, setStats] = useState({ usuarios: 0, pendientes: 0, cursos: 0, errores: 0 });
  const [pendientes, setPendientes] = useState([]);
  const [err, setErr] = useState('');
  const [grades, setGrades] = useState({});
  const [credenciales, setCredenciales] = useState(null);

  const ir = (tab) => {
    if (onNavigate && can(tab)) onNavigate(tab);
  };
  const entrarAlCampus = async (matriculaId) => {
    try {
      const { url, usuario_moodle, password_inicial } = await obtenerAccesoCampus(matriculaId);
      if (password_inicial) {
        setCredenciales({ url, usuario: usuario_moodle, password: password_inicial });
      } else {
        irACampus(url);
      }
    } catch (e) {
      setErr(e.message);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      if (esAlumno || esAspirante) {
        const { data, error } = await supabase
          .from('matriculas')
          .select('id,rol_moodle,moodle_estado,curso:cursos(id,nombre,programa,moodle_course_id)')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setMats(data || []);
      }

      if (esStaff) {
        const conteo = (tabla, filtro) => {
          let q = supabase.from(tabla).select('id', { count: 'exact', head: true });
          if (filtro) q = filtro(q);
          return q;
        };

        const [u, p, c, e, lista] = await Promise.all([
          conteo('profiles'),
          conteo('profiles', (q) => q.eq('estado', 'Pendiente')),
          conteo('cursos'),
          conteo('matriculas', (q) => q.eq('moodle_estado', 'Error')),
          supabase
            .from('profiles')
            .select('id,nombre,apellidos,email,rol,created_at')
            .eq('estado', 'Pendiente')
            .order('created_at', { ascending: false })
            .limit(5),
        ]);

        setStats({
          usuarios: u.count ?? 0,
          pendientes: p.count ?? 0,
          cursos: c.count ?? 0,
          errores: e.count ?? 0,
        });
        setPendientes(lista.data || []);
      }
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esAlumno, esAspirante, esStaff]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const canal = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matriculas' }, () => {
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cursos' }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [load]);

  useEffect(() => {
    if (rol !== 'estudiante') return;
    mats.forEach((m) => {
      if (m.moodle_estado === 'Sincronizada' && m.curso?.moodle_course_id && grades[m.id] === undefined) {
        setGrades((g) => ({ ...g, [m.id]: 'cargando' }));
        api(`/api/moodle/grade/${m.id}`)
          .then((d) => setGrades((g) => ({ ...g, [m.id]: d.calificacion || 'Aún sin calificar' })))
          .catch(() => setGrades((g) => ({ ...g, [m.id]: 'No disponible' })));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mats, rol]);

  const nombre = profile?.nombre || 'bienvenido';
  const rolLabel = rol ? ROLES[rol]?.label : '';

  /* ---------- Tarjetas de resumen según el rol ---------- */
  let tarjetas = [];
  if (esAlumno) {
    tarjetas = [
      { valor: mats.length, etiqueta: 'Cursos matriculados', icono: 'cap' },
      {
        valor: profile?.moodle_user_id ? 'Vinculada' : 'Pendiente',
        etiqueta: 'Cuenta en Moodle',
        icono: 'layers',
        tono: profile?.moodle_user_id ? 'verde' : 'ambar',
        texto: true,
      },
      { valor: profile?.programa || 'Sin asignar', etiqueta: 'Programa', icono: 'book', tono: 'violeta', texto: true },
    ];
  } else if (esAspirante) {
    tarjetas = [
      { valor: estado || '—', etiqueta: 'Estado de tu solicitud', icono: 'clock', tono: estado === 'Activo' ? 'verde' : 'ambar', texto: true },
      { valor: profile?.programa || 'Sin asignar', etiqueta: 'Programa', icono: 'book', tono: 'violeta', texto: true },
    ];
  } else if (esStaff) {
    tarjetas = [
      { valor: stats.usuarios, etiqueta: 'Usuarios en tu ámbito', icono: 'users' },
      { valor: stats.pendientes, etiqueta: 'Pendientes de autorización', icono: 'clock', tono: 'ambar' },
    ];
    if (rol !== 'soporte') tarjetas.push({ valor: stats.cursos, etiqueta: 'Cursos en tu ámbito', icono: 'cap', tono: 'verde' });
    if (esAdmin) {
      tarjetas.push({
        valor: stats.errores,
        etiqueta: 'Matrículas con error',
        icono: 'alert',
        tono: stats.errores > 0 ? 'rojo' : 'violeta',
      });
    }
  }

  /* ---------- Pasos de admisión (aspirante) ---------- */
  const pasos = [
    { t: 'Registro de cuenta', d: 'Tu cuenta fue creada correctamente.', hecho: true },
    { t: 'Revisión de solicitud', d: 'Un administrador revisa tus datos.', hecho: estado === 'Activo' },
    { t: 'Autorización y rol', d: 'Se te asigna tu rol y tu programa.', hecho: rol !== 'aspirante' && estado === 'Activo' },
    { t: 'Matrícula en cursos', d: 'Recibes acceso a los cursos autorizados.', hecho: mats.length > 0 },
  ];
  const indiceActual = pasos.findIndex((p) => !p.hecho);

  return (
    <div className="dash">
      <HeroBanner />

      {err && <div className="alert alert--error">{err}</div>}

      {/* ---------- Saludo + resumen ---------- */}
      <section className="panel panel--greeting">
        <div className="dash-head">
          <div>
            <h2>Hola, {nombre}</h2>
            <p>
              {rolLabel}
              {profile?.programa ? ` · ${profile.programa}` : ''}
            </p>
          </div>
          <span className={`status ${claseEstado(estado)}`}><i /> {estado || '—'}</span>
        </div>

        {loading ? (
          <div className="empty">Cargando tu panel…</div>
        ) : (
          <div className="stat-grid">
            {tarjetas.map((t) => (
              <div className={`stat ${t.tono ? `stat--${t.tono}` : ''} ${t.texto ? 'stat--text' : ''}`} key={t.etiqueta}>
                <span className="stat__icon"><Icon name={t.icono} /></span>
                <div>
                  <strong>{t.valor}</strong>
                  <span className="stat__label">{t.etiqueta}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {!loading && (
        <>
          {/* ---------- Estudiante / Profesor ---------- */}
          {esAlumno && (
            <section className="panel">
              <div className="panel__head">
                <span className="panel__icon"><Icon name="cap" /></span>
                <h3>Mis cursos</h3>
                {can('courses') && mats.length > 3 && (
                  <button className="panel__more" onClick={() => ir('courses')}>
                    Ver todos <Icon name="arrow" />
                  </button>
                )}
              </div>
              {mats.length === 0 ? (
                <div className="empty-state">
                  <EmptyArt />
                  <p>Todavía no tienes cursos asignados. Tu acceso depende de una matrícula autorizada.</p>
                </div>
              ) : rol === 'estudiante' ? (
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead>
                      <tr>
                        <th>Curso</th>
                        <th>Calificación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mats.slice(0, 3).map((m) => (
                        <tr key={m.id}>
                          <td className="who">
                            <strong>{m.curso?.nombre}</strong>
                            <small>{m.curso?.programa || 'Sin programa'}</small>
                          </td>
                          <td>
                            <span className="badge">
                              {grades[m.id] === undefined || grades[m.id] === 'cargando' ? 'Cargando…' : grades[m.id]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="course-grid">
                  {mats.slice(0, 3).map((m) => (
                    <article className="course-card" key={m.id}>
                      <span className={`badge ${m.moodle_estado === 'Sincronizada' ? 'badge--ok' : 'badge--warn'}`}>
                        {m.rol_moodle === 'teacher' ? 'Profesor del curso' : 'Estudiante'}
                      </span>
                      <h3>{m.curso?.nombre}</h3>
                      <p>{m.curso?.programa || 'Sin programa'}</p>
                      {MOODLE_URL && m.curso?.moodle_course_id && m.moodle_estado === 'Sincronizada' ? (
                        <button
                          className="btn btn--primary btn--xs"
                          onClick={() => entrarAlCampus(m.id)}
                        >
                          Acceder al campus
                        </button>
                      ) : (
                        <button className="btn btn--light btn--xs" disabled>Acceso en proceso</button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ---------- Aspirante ---------- */}
          {esAspirante && (
            <section className="panel">
              <div className="panel__head">
                <span className="panel__icon"><Icon name="clipboard" /></span>
                <h3>Seguimiento de admisión</h3>
              </div>
              <ol className="stepper">
                {pasos.map((p, i) => (
                  <li
                    key={p.t}
                    className={`step-item ${p.hecho ? 'done' : ''} ${i === indiceActual ? 'current' : ''}`}
                  >
                    <span className="step-item__dot">{p.hecho ? '✓' : i + 1}</span>
                    <div>
                      <strong>{p.t}</strong>
                      <small>{p.d}</small>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="hint">
                Mientras tu solicitud no sea autorizada no tendrás acceso a cursos. Puedes actualizar tus datos
                en Trámites y en tu perfil.
              </p>
            </section>
          )}

          {/* ---------- Administración, coordinación y soporte ---------- */}
          {esStaff && (
            <section className="panel">
              {esAdmin && stats.errores > 0 && (
                <div className="alert alert--error">
                  Hay {stats.errores} matrícula(s) con error de sincronización con Moodle.{' '}
                  {can('courses') && (
                    <button className="link-inline" onClick={() => ir('courses')}>Revisar ahora</button>
                  )}
                </div>
              )}

              <div className="panel__head">
                <span className="panel__icon"><Icon name="clipboard" /></span>
                <h3>Solicitudes pendientes</h3>
                {can('users') && pendientes.length > 0 && (
                  <button className="panel__more" onClick={() => ir('users')}>
                    Ver todas <Icon name="arrow" />
                  </button>
                )}
              </div>

              {pendientes.length === 0 ? (
                <div className="empty-state">
                  <EmptyArt />
                  <p>No hay solicitudes pendientes dentro de tu ámbito.</p>
                  {can('users') && (
                    <button className="btn btn--primary" onClick={() => ir('users')}>
                      {esAdmin ? 'Revisar y autorizar usuarios' : 'Ver usuarios'}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <ul className="pending-list">
                    {pendientes.map((u) => (
                      <li key={u.id}>
                        <div>
                          <strong>{`${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email}</strong>
                          <small>{u.email} · registrado el {fecha(u.created_at)}</small>
                        </div>
                        <span className="badge badge--warn">{ROLES[u.rol]?.label || u.rol}</span>
                      </li>
                    ))}
                  </ul>
                  {can('users') && (
                    <p style={{ marginTop: 16 }}>
                      <button className="btn btn--primary" onClick={() => ir('users')}>
                        {esAdmin ? 'Revisar y autorizar usuarios' : 'Ver usuarios'}
                      </button>
                    </p>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
      {credenciales && (
        <div className="doc-overlay" role="dialog" aria-modal="true">
          <div className="doc-overlay__backdrop" onClick={() => { setCredenciales(null); }} />
          <div className="doc-sheet" style={{ maxWidth: 420 }}>
            <h3>Acceso al campus Moodle</h3>
            <p>Esta es tu contraseña inicial. Guárdala, no se volverá a mostrar.</p>
            <p><strong>Usuario:</strong> {credenciales.usuario}</p>
            <p><strong>Contraseña:</strong> {credenciales.password}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn--primary"
                onClick={() => {
                  const url = credenciales.url;
                  setCredenciales(null);
                  irACampus(url);
                }}
              >
                Ir al campus
              </button>
              <button className="btn btn--light" onClick={() => setCredenciales(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}