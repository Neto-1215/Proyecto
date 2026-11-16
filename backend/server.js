require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { moodle, asegurarUsuarioMoodle, ROLES_MOODLE } = require('./moodle');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  FRONTEND_URL = 'http://localhost:3000',
  PORT = 4000,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en backend/.env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const app = express();
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

/* ---------- Seguridad: valida la sesión de Supabase y el rol ---------- */
async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Falta la sesión. Inicia sesión de nuevo.' });

    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Sesión inválida o vencida.' });

    const { data: perfil, error: perfilError } = await sb
      .from('profiles')
      .select('id,rol,estado,email')
      .eq('id', data.user.id)
      .maybeSingle();

    if (perfilError) {
      return res.status(500).json({ error: `No se pudo leer tu perfil: ${perfilError.message}` });
    }
    if (!perfil) {
      return res.status(403).json({
        error: 'Tu usuario no tiene perfil. Revisa que SUPABASE_SERVICE_ROLE_KEY sea la clave service_role o secret.',
      });
    }

    req.user = perfil;
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

const requireRol = (...roles) => (req, res, next) =>
  roles.includes(req.user.rol) && req.user.estado === 'Activo'
    ? next()
    : res.status(403).json({ error: 'No tienes permiso para esta acción.' });

const soloAdmin = requireRol('superadmin', 'administrador');

// Captura errores de funciones async
const ah = (fn) => (req, res) =>
  fn(req, res).catch((e) => res.status(500).json({ error: e.message || 'Error interno' }));

const MATRICULA_SELECT =
  'id,user_id,rol_moodle,estado,moodle_estado,' +
  'curso:cursos(id,nombre,moodle_course_id),' +
  'perfil:profiles(id,email,nombre,apellidos,rol,estado,moodle_user_id)';

/* ---------- Rutas ---------- */

// Comprobar conexión con Moodle
app.get('/api/moodle/status', auth, soloAdmin, ah(async (req, res) => {
  const info = await moodle('core_webservice_get_site_info');
  res.json({ sitio: info.sitename, version: info.release, usuario: info.username });
}));

// Lista los cursos de Moodle y marca los que ya están importados
app.get('/api/moodle/courses', auth, soloAdmin, ah(async (req, res) => {
  const lista = await moodle('core_course_get_courses');
  const { data: locales } = await sb.from('cursos').select('moodle_course_id');
  const importados = new Set((locales || []).map((c) => c.moodle_course_id));

  res.json(
    lista
      .filter((c) => c.id !== 1) // el 1 es la portada del sitio
      .map((c) => ({
        id: c.id,
        nombre: c.fullname,
        corto: c.shortname,
        visible: !!c.visible,
        importado: importados.has(c.id),
      }))
  );
}));

// Importa cursos de Moodle a la tabla cursos
app.post('/api/moodle/import-courses', auth, soloAdmin, ah(async (req, res) => {
  const { cursos = [], programa = null } = req.body || {};
  if (!cursos.length) return res.status(400).json({ error: 'No elegiste ningún curso.' });

  const filas = cursos.map((c) => ({
    nombre: c.nombre,
    moodle_course_id: Number(c.id),
    programa: programa || null,
    activo: true,
  }));

  const { error } = await sb.from('cursos').upsert(filas, { onConflict: 'moodle_course_id' });
  if (error) throw error;
  res.json({ ok: true, importados: filas.length });
}));

// Crea o vincula un usuario en Moodle y guarda moodle_user_id
app.post('/api/moodle/sync-user', auth, soloAdmin, ah(async (req, res) => {
  const { user_id } = req.body || {};
  const { data: perfil } = await sb
    .from('profiles')
    .select('id,email,nombre,apellidos,rol,estado')
    .eq('id', user_id)
    .maybeSingle();

  if (!perfil) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (!['estudiante', 'profesor'].includes(perfil.rol))
    return res.status(400).json({ error: 'Solo Estudiantes y Profesores se sincronizan con Moodle.' });
  if (perfil.estado !== 'Activo')
    return res.status(400).json({ error: 'El usuario aún no está autorizado (estado Activo).' });

  const moodleId = await asegurarUsuarioMoodle(perfil);
  const { error } = await sb.from('profiles').update({ moodle_user_id: String(moodleId) }).eq('id', perfil.id);
  if (error) throw error;
  res.json({ ok: true, moodle_user_id: moodleId });
}));

// Matricula en Moodle una matrícula ya registrada en Supabase
app.post('/api/moodle/enrol', auth, soloAdmin, ah(async (req, res) => {
  const { matricula_id } = req.body || {};
  const { data: m } = await sb.from('matriculas').select(MATRICULA_SELECT).eq('id', matricula_id).maybeSingle();

  if (!m) return res.status(404).json({ error: 'Matrícula no encontrada.' });
  if (m.perfil.estado !== 'Activo')
    return res.status(400).json({ error: 'El usuario aún no está autorizado.' });
  if (!m.curso?.moodle_course_id)
    return res.status(400).json({ error: 'El curso no tiene ID de Moodle. Impórtalo desde "API de Moodle".' });

  try {
    const moodleId = await asegurarUsuarioMoodle(m.perfil);

    if (String(m.perfil.moodle_user_id) !== String(moodleId)) {
      await sb.from('profiles').update({ moodle_user_id: String(moodleId) }).eq('id', m.perfil.id);
    }

    await moodle('enrol_manual_enrol_users', {
      enrolments: [
        {
          roleid: ROLES_MOODLE[m.rol_moodle],
          userid: moodleId,
          courseid: m.curso.moodle_course_id,
        },
      ],
    });

    await sb.from('matriculas').update({ moodle_estado: 'Sincronizada', moodle_error: null }).eq('id', m.id);
    res.json({ ok: true, moodle_user_id: moodleId });
  } catch (e) {
    await sb
      .from('matriculas')
      .update({ moodle_estado: 'Error', moodle_error: String(e.message).slice(0, 300) })
      .eq('id', m.id);
    res.status(502).json({ error: e.message });
  }
}));

// Calificación del alumno en un curso (trae el total del curso y el detalle por actividad)
app.get('/api/moodle/grade/:matricula_id', auth, ah(async (req, res) => {
  const { matricula_id } = req.params;
  const { data: m } = await sb.from('matriculas').select(MATRICULA_SELECT).eq('id', matricula_id).maybeSingle();

  if (!m) return res.status(404).json({ error: 'Matrícula no encontrada.' });

  const esPropia = m.user_id === req.user.id;
  const puedeVerOtras = ['superadmin', 'administrador', 'coordinador', 'profesor'].includes(req.user.rol);
  if (!esPropia && !puedeVerOtras) return res.status(403).json({ error: 'No autorizado.' });

  if (!m.curso?.moodle_course_id) return res.json({ calificacion: null, items: [] });
  if (m.moodle_estado !== 'Sincronizada') {
    return res.json({ calificacion: null, items: [], aviso: 'Aún no sincronizado con Moodle.' });
  }

  try {
    const moodleId = await asegurarUsuarioMoodle(m.perfil);
    const data = await moodle('gradereport_user_get_grade_items', {
      courseid: m.curso.moodle_course_id,
      userid: moodleId,
    });

    const items = data?.usergrades?.[0]?.gradeitems || [];
    const total = items.find((it) => it.itemtype === 'course');

    res.json({
      calificacion: total?.gradeformatted?.trim() || null,
      items: items
        .filter((it) => it.itemtype === 'mod' || it.itemtype === 'manual')
        .map((it) => ({ nombre: it.itemname, calificacion: it.gradeformatted?.trim() || null })),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

// Desmatricula en Moodle y borra la matrícula
app.post('/api/moodle/unenrol', auth, soloAdmin, ah(async (req, res) => {
  const { matricula_id } = req.body || {};
  const { data: m } = await sb.from('matriculas').select(MATRICULA_SELECT).eq('id', matricula_id).maybeSingle();
  if (!m) return res.status(404).json({ error: 'Matrícula no encontrada.' });

  if (m.moodle_estado === 'Sincronizada' && m.perfil?.moodle_user_id && m.curso?.moodle_course_id) {
    try {
      await moodle('enrol_manual_unenrol_users', {
        enrolments: [
          {
            userid: Number(m.perfil.moodle_user_id),
            courseid: m.curso.moodle_course_id,
            roleid: ROLES_MOODLE[m.rol_moodle],
          },
        ],
      });
    } catch (e) {
      return res.status(502).json({ error: `No se pudo desmatricular en Moodle: ${e.message}` });
    }
  }

  const { error } = await sb.from('matriculas').delete().eq('id', m.id);
  if (error) throw error;
  res.json({ ok: true });
}));

// Acceso directo al curso (SSO): devuelve una URL de Moodle que inicia sesión sola
app.post('/api/moodle/launch', auth, ah(async (req, res) => {
  if (req.user.estado !== 'Activo') {
    return res.status(403).json({ error: 'Tu cuenta no está activa.' });
  }
  const { matricula_id } = req.body || {};
  if (!matricula_id) return res.status(400).json({ error: 'Falta matricula_id.' });

  const { data: m, error } = await sb
    .from('matriculas')
    .select(MATRICULA_SELECT)
    .eq('id', matricula_id)
    .maybeSingle();
  if (error) throw error;
  if (!m || m.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Esa matrícula no es tuya.' });
  }
  if (m.moodle_estado !== 'Sincronizada' || !m.curso?.moodle_course_id) {
    return res.status(409).json({ error: 'El curso aún no está sincronizado con Moodle.' });
  }

  const base = (process.env.MOODLE_URL || '').replace(/\/$/, '');
  const destino = `${base}/course/view.php?id=${m.curso.moodle_course_id}`;

  let r;
  try {
    r = await moodle('auth_userkey_request_login_url', {
      user: { email: String(m.perfil.email).toLowerCase() },
    });
  } catch (e) {
    return res.status(502).json({ error: `No se pudo generar el acceso directo: ${e.message}` });
  }
  if (!r?.loginurl) {
    return res.status(502).json({ error: 'Moodle no devolvió la URL de acceso (revisa el plugin userkey).' });
  }

  const sep = r.loginurl.includes('?') ? '&' : '?';
  res.json({ url: `${r.loginurl}${sep}wantsurl=${encodeURIComponent(destino)}` });
}));

// Elimina un usuario (solo Superadministrador)
app.delete('/api/users/:id', auth, requireRol('superadmin'), ah(async (req, res) => {
  const id = req.params.id;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  }

  const { data: objetivo } = await sb
    .from('profiles')
    .select('id,email,nombre,apellidos,rol,estado,programa,moodle_user_id')
    .eq('id', id)
    .maybeSingle();

  if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (objetivo.rol === 'superadmin') {
    return res.status(400).json({ error: 'No se puede eliminar a un Superadministrador. Cámbiale el rol primero.' });
  }

  // Moodle: se suspende la cuenta (no se borra) para conservar calificaciones y evidencias
  let moodleResultado = 'sin cuenta';
  let moodleAviso = null;
  if (objetivo.moodle_user_id && /^\d+$/.test(String(objetivo.moodle_user_id))) {
    try {
      await moodle('core_user_update_users', {
        users: [{ id: Number(objetivo.moodle_user_id), suspended: 1 }],
      });
      moodleResultado = 'suspendida';
    } catch (e) {
      moodleResultado = 'error';
      moodleAviso = e.message;
    }
  }

  // Auditoría antes de borrar
  await sb.from('audit_log').insert({
    actor: req.user.id,
    actor_rol: req.user.rol,
    accion: 'usuario_eliminado',
    objetivo: id,
    antes: {
      email: objetivo.email,
      nombre: `${objetivo.nombre || ''} ${objetivo.apellidos || ''}`.trim(),
      rol: objetivo.rol,
      estado: objetivo.estado,
      programa: objetivo.programa,
      moodle_user_id: objetivo.moodle_user_id,
      moodle: moodleResultado,
    },
    despues: null,
  });

  // Se borra el perfil (matrículas y trámites se eliminan en cascada) y después la cuenta de acceso
  const { error: errPerfil } = await sb.from('profiles').delete().eq('id', id);
  if (errPerfil) throw errPerfil;

  const { error: errAuth } = await sb.auth.admin.deleteUser(id);
  if (errAuth) throw new Error(`Se borró el perfil, pero no la cuenta de acceso: ${errAuth.message}`);

  res.json({ ok: true, moodle: moodleResultado, moodle_aviso: moodleAviso });
}));

app.listen(PORT, () => console.log(`Backend IINICIA escuchando en http://localhost:${PORT}`));