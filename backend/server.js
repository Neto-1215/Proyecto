require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { moodle, asegurarUsuarioMoodle, ROLES_MOODLE } = require('./moodle');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  FRONTEND_URL = 'http://localhost:3000',
  PORT = 4000,
  REQUIRE_MFA = 'true', // exige sesión con segundo factor (aal2). Solo desactívalo en desarrollo.
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en backend/.env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: FRONTEND_URL, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '20kb' }));

// Límite general por IP y uno más estricto para acciones que escriben o llaman a Moodle
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
const limiteEscritura = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera un momento.' },
});

/* ---------- Utilidades ---------- */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const exigirUuid = (v, campo) => {
  if (!esUuid(v)) throw new HttpError(400, `${campo} no es válido.`);
  return v;
};
// IDs de tablas de la app: UUID o entero positivo (según cómo se crearon las tablas)
const exigirId = (v, campo) => {
  if (esUuid(v)) return v;
  if ((typeof v === 'number' || typeof v === 'string') && /^\d{1,15}$/.test(String(v))) return String(v);
  throw new HttpError(400, `${campo} no es válido.`);
};

// Lee el nivel de autenticación (aal) del JWT. El token ya fue validado por Supabase en getUser().
function aalDelToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.aal;
  } catch {
    return null;
  }
}

/* ---------- Seguridad: valida la sesión de Supabase, el segundo factor y el rol ---------- */
async function auth(req, res, next) {
  try {
    const cabecera = req.headers.authorization || '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Falta la sesión. Inicia sesión de nuevo.' });

    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Sesión inválida o vencida.' });

    // Sin el segundo factor verificado no hay acceso a la API (evita saltarse el MFA del frontend)
    if (REQUIRE_MFA !== 'false' && aalDelToken(token) !== 'aal2') {
      return res.status(401).json({ error: 'Falta la verificación en dos pasos. Inicia sesión de nuevo.' });
    }

    const { data: perfil, error: perfilError } = await sb
      .from('profiles')
      .select('id,rol,estado,email,ambito')
      .eq('id', data.user.id)
      .maybeSingle();

    if (perfilError) {
      console.error('auth: error leyendo perfil:', perfilError.message);
      return res.status(500).json({ error: 'No se pudo leer tu perfil.' });
    }
    if (!perfil) return res.status(403).json({ error: 'Tu usuario no tiene perfil.' });

    req.user = perfil;
    next();
  } catch (e) {
    console.error('auth:', e);
    res.status(500).json({ error: 'Error interno' });
  }
}

const requireRol = (...roles) => (req, res, next) =>
  roles.includes(req.user.rol) && req.user.estado === 'Activo'
    ? next()
    : res.status(403).json({ error: 'No tienes permiso para esta acción.' });

const soloAdmin = requireRol('superadmin', 'administrador');

// Captura errores de funciones async. Los errores internos no se muestran al cliente.
const ah = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error(`${req.method} ${req.path}:`, e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

const MATRICULA_SELECT =
  'id,user_id,rol_moodle,estado,moodle_estado,' +
  'curso:cursos(id,nombre,moodle_course_id),' +
  'perfil:profiles(id,email,nombre,apellidos,rol,estado,moodle_user_id,moodle_password_inicial)';

const ROLES_VALIDOS = ['superadmin', 'administrador', 'coordinador', 'profesor', 'estudiante', 'aspirante', 'soporte'];
const ESTADOS_VALIDOS = ['Pendiente', 'Activo', 'Suspendido'];
const ROLES_ASIGNABLES = {
  superadmin: ROLES_VALIDOS,
  administrador: ['coordinador', 'profesor', 'estudiante', 'aspirante', 'soporte'],
};
const TIPO_INSCRIPCION = 'Inscripción a curso';

const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function sincronizarMatricula(m) {
  try {
    const { id: moodleId, password } = await asegurarUsuarioMoodle(m.perfil);

    const cambiosPerfil = {};
    if (String(m.perfil.moodle_user_id) !== String(moodleId)) cambiosPerfil.moodle_user_id = String(moodleId);
    if (password) cambiosPerfil.moodle_password_inicial = password;
    if (Object.keys(cambiosPerfil).length) {
      await sb.from('profiles').update(cambiosPerfil).eq('id', m.perfil.id);
    }

    await moodle('enrol_manual_enrol_users', {
      enrolments: [{ roleid: ROLES_MOODLE[m.rol_moodle], userid: moodleId, courseid: m.curso.moodle_course_id }],
    });

    await sb.from('matriculas').update({ moodle_estado: 'Sincronizada', moodle_error: null }).eq('id', m.id);
    return moodleId;
  } catch (e) {
    await sb
      .from('matriculas')
      .update({ moodle_estado: 'Error', moodle_error: String(e.message).slice(0, 300) })
      .eq('id', m.id);
    throw new HttpError(502, 'No se pudo sincronizar con Moodle. Revisa la conexión e inténtalo de nuevo.');
  }
}

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

// Importa cursos de Moodle a la tabla cursos (el nombre se toma de Moodle, no del cliente)
app.post('/api/moodle/import-courses', auth, soloAdmin, limiteEscritura, ah(async (req, res) => {
  const { cursos, programa } = req.body || {};
  if (!Array.isArray(cursos) || cursos.length === 0) throw new HttpError(400, 'No elegiste ningún curso.');
  if (cursos.length > 200) throw new HttpError(400, 'Demasiados cursos en una sola importación.');

  const ids = [...new Set(cursos.map((c) => Number(c?.id)))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 1)) throw new HttpError(400, 'Hay un curso con ID inválido.');

  const lista = await moodle('core_course_get_courses');
  const deMoodle = new Map(lista.map((c) => [c.id, c]));
  const faltantes = ids.filter((n) => !deMoodle.has(n));
  if (faltantes.length) throw new HttpError(400, `Estos cursos no existen en Moodle: ${faltantes.join(', ')}`);

  const prog = texto(programa, 120) || null;
  const filas = ids.map((n) => ({
    nombre: String(deMoodle.get(n).fullname).slice(0, 200),
    moodle_course_id: n,
    programa: prog,
    activo: true,
  }));

  const { error } = await sb.from('cursos').upsert(filas, { onConflict: 'moodle_course_id' });
  if (error) throw error;
  res.json({ ok: true, importados: filas.length });
}));

// Crea o vincula un usuario en Moodle y guarda moodle_user_id
app.post('/api/moodle/sync-user', auth, soloAdmin, limiteEscritura, ah(async (req, res) => {
  const user_id = exigirUuid((req.body || {}).user_id, 'user_id');
  const { data: perfil } = await sb
    .from('profiles')
    .select('id,email,nombre,apellidos,rol,estado')
    .eq('id', user_id)
    .maybeSingle();

  if (!perfil) throw new HttpError(404, 'Usuario no encontrado.');
  if (!['estudiante', 'profesor'].includes(perfil.rol))
    throw new HttpError(400, 'Solo Estudiantes y Profesores se sincronizan con Moodle.');
  if (perfil.estado !== 'Activo') throw new HttpError(400, 'El usuario aún no está autorizado (estado Activo).');

  const { id: moodleId, password } = await asegurarUsuarioMoodle(perfil);
  const cambios = { moodle_user_id: String(moodleId) };
  if (password) cambios.moodle_password_inicial = password;
  const { error } = await sb.from('profiles').update(cambios).eq('id', perfil.id);
  if (error) throw error;
  res.json({ ok: true, moodle_user_id: moodleId });
}));

// Crea una matrícula (solo administradores). Devuelve la existente si ya estaba matriculado.
app.post('/api/matriculas', auth, soloAdmin, limiteEscritura, ah(async (req, res) => {
  const user_id = exigirUuid((req.body || {}).user_id, 'user_id');
  const curso_id = exigirId((req.body || {}).curso_id, 'curso_id');
  const m = await crearMatricula(user_id, curso_id);
  res.json(m);
}));

async function crearMatricula(user_id, curso_id) {
  const [{ data: perfil }, { data: curso }] = await Promise.all([
    sb.from('profiles').select('id,rol,estado').eq('id', user_id).maybeSingle(),
    sb.from('cursos').select('id,activo').eq('id', curso_id).maybeSingle(),
  ]);
  if (!perfil) throw new HttpError(404, 'Usuario no encontrado.');
  if (!curso || !curso.activo) throw new HttpError(404, 'Curso no disponible.');
  if (perfil.estado !== 'Activo') throw new HttpError(400, 'El usuario aún no está autorizado.');
  if (!['estudiante', 'profesor'].includes(perfil.rol))
    throw new HttpError(400, 'Solo Estudiantes y Profesores pueden matricularse.');

  const rol_moodle = perfil.rol === 'profesor' ? 'teacher' : 'student';
  const { data: nueva, error } = await sb
    .from('matriculas')
    .insert([{ user_id, curso_id, rol_moodle }])
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: existente } = await sb
        .from('matriculas')
        .select('id')
        .eq('user_id', user_id)
        .eq('curso_id', curso_id)
        .maybeSingle();
      return { id: existente?.id, existente: true };
    }
    throw error;
  }
  return { id: nueva.id, existente: false };
}

// Matricula en Moodle una matrícula ya registrada en Supabase
app.post('/api/moodle/enrol', auth, soloAdmin, limiteEscritura, ah(async (req, res) => {
  const matricula_id = exigirId((req.body || {}).matricula_id, 'matricula_id');
  const { data: m } = await sb.from('matriculas').select(MATRICULA_SELECT).eq('id', matricula_id).maybeSingle();

  if (!m) throw new HttpError(404, 'Matrícula no encontrada.');
  if (m.perfil.estado !== 'Activo') throw new HttpError(400, 'El usuario aún no está autorizado.');
  if (!m.curso?.moodle_course_id)
    throw new HttpError(400, 'El curso no tiene ID de Moodle. Impórtalo desde "API de Moodle".');

  const moodleId = await sincronizarMatricula(m);
  res.json({ ok: true, moodle_user_id: moodleId });
}));

// Calificación del alumno en un curso (trae el total del curso y el detalle por actividad)
app.get('/api/moodle/grade/:matricula_id', auth, ah(async (req, res) => {
  const matricula_id = exigirId(req.params.matricula_id, 'matricula_id');
  if (req.user.estado !== 'Activo') throw new HttpError(403, 'Tu cuenta no está activa.');

  const { data: m } = await sb.from('matriculas').select(MATRICULA_SELECT).eq('id', matricula_id).maybeSingle();
  if (!m) throw new HttpError(404, 'Matrícula no encontrada.');

  let autorizado = m.user_id === req.user.id || ['superadmin', 'administrador', 'coordinador'].includes(req.user.rol);

  // Un profesor solo ve calificaciones de los cursos en los que él mismo está matriculado
  if (!autorizado && req.user.rol === 'profesor' && m.curso?.id) {
    const { data: propia } = await sb
      .from('matriculas')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('curso_id', m.curso.id)
      .eq('rol_moodle', 'teacher')
      .maybeSingle();
    autorizado = !!propia;
  }
  if (!autorizado) throw new HttpError(403, 'No autorizado.');

  if (!m.curso?.moodle_course_id) return res.json({ calificacion: null, items: [] });
  if (m.moodle_estado !== 'Sincronizada') {
    return res.json({ calificacion: null, items: [], aviso: 'Aún no sincronizado con Moodle.' });
  }

  let data;
  try {
    const { id: moodleId } = await asegurarUsuarioMoodle(m.perfil);
    data = await moodle('gradereport_user_get_grade_items', {
      courseid: m.curso.moodle_course_id,
      userid: moodleId,
    });
  } catch (e) {
    console.error('grade:', e.message);
    throw new HttpError(502, 'No se pudo consultar la calificación en Moodle.');
  }

  const items = data?.usergrades?.[0]?.gradeitems || [];
  const total = items.find((it) => it.itemtype === 'course');

  res.json({
    calificacion: total?.gradeformatted?.trim() || null,
    items: items
      .filter((it) => it.itemtype === 'mod' || it.itemtype === 'manual')
      .map((it) => ({ nombre: it.itemname, calificacion: it.gradeformatted?.trim() || null })),
  });
}));

// Desmatricula en Moodle y borra la matrícula
app.post('/api/moodle/unenrol', auth, soloAdmin, limiteEscritura, ah(async (req, res) => {
  const matricula_id = exigirId((req.body || {}).matricula_id, 'matricula_id');
  const { data: m } = await sb.from('matriculas').select(MATRICULA_SELECT).eq('id', matricula_id).maybeSingle();
  if (!m) throw new HttpError(404, 'Matrícula no encontrada.');

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
      console.error('unenrol:', e.message);
      throw new HttpError(502, 'No se pudo desmatricular en Moodle.');
    }
  }

  const { error } = await sb.from('matriculas').delete().eq('id', m.id);
  if (error) throw error;
  res.json({ ok: true });
}));

// Acceso directo al curso: lleva al usuario a la página del curso en Moodle.
// MoodleCloud no permite el plugin de login automático (auth_userkey), así que
// el usuario inicia sesión en Moodle con su propio usuario/contraseña si no lo ha hecho.
app.post('/api/moodle/launch', auth, limiteEscritura, ah(async (req, res) => {
  if (req.user.estado !== 'Activo') throw new HttpError(403, 'Tu cuenta no está activa.');
  const matricula_id = exigirId((req.body || {}).matricula_id, 'matricula_id');

  const { data: m, error } = await sb
    .from('matriculas')
    .select(MATRICULA_SELECT)
    .eq('id', matricula_id)
    .maybeSingle();
  if (error) throw error;
  if (!m || m.user_id !== req.user.id) throw new HttpError(403, 'Esa matrícula no es tuya.');
  if (m.moodle_estado !== 'Sincronizada' || !m.curso?.moodle_course_id) {
    throw new HttpError(409, 'El curso aún no está sincronizado con Moodle.');
  }

  const base = (process.env.MOODLE_URL || '').replace(/\/$/, '');
  const destino = `${base}/course/view.php?id=${Number(m.curso.moodle_course_id)}`;

  // Si tiene una contraseña inicial pendiente de mostrar, se la mandamos una sola vez
  // y la borramos de la base de datos.
  const password_inicial = m.perfil?.moodle_password_inicial || null;
  if (password_inicial) {
    await sb.from('profiles').update({ moodle_password_inicial: null }).eq('id', m.perfil.id);
  }

  res.json({ url: destino, usuario_moodle: m.perfil.email, password_inicial });
}));

// Actualiza rol, estado, programa o ámbito de un usuario, validado en el servidor
app.patch('/api/users/:id', auth, requireRol('superadmin', 'administrador', 'coordinador'), limiteEscritura, ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'id');
  const body = req.body || {};
  const actor = req.user;

  if (id === actor.id) throw new HttpError(400, 'No puedes modificar tu propia cuenta.');

  const { data: objetivo } = await sb
    .from('profiles')
    .select('id,rol,estado,programa,ambito')
    .eq('id', id)
    .maybeSingle();
  if (!objetivo) throw new HttpError(404, 'Usuario no encontrado.');

  const esAdmin = ['superadmin', 'administrador'].includes(actor.rol);

  if (esAdmin) {
    // El Administrador no toca cuentas de Superadministrador ni de otros Administradores
    if (actor.rol !== 'superadmin' && ['superadmin', 'administrador'].includes(objetivo.rol)) {
      throw new HttpError(403, 'No tienes permiso sobre este usuario.');
    }
  } else {
    // El Coordinador solo gestiona solicitudes pendientes dentro de su ámbito
    const enAmbito =
      !Array.isArray(actor.ambito) || actor.ambito.length === 0 || actor.ambito.includes(objetivo.programa);
    if (objetivo.estado !== 'Pendiente' || !enAmbito) {
      throw new HttpError(403, 'No tienes permiso sobre este usuario.');
    }
    if (body.ambito !== undefined) throw new HttpError(403, 'No puedes cambiar el ámbito.');
  }

  const cambios = {};

  if (body.rol !== undefined) {
    const permitidos = esAdmin ? ROLES_ASIGNABLES[actor.rol] : ['estudiante', 'profesor'];
    if (!permitidos.includes(body.rol)) throw new HttpError(403, 'No puedes asignar ese rol.');
    cambios.rol = body.rol;
  }
  if (body.estado !== undefined) {
    if (!ESTADOS_VALIDOS.includes(body.estado)) throw new HttpError(400, 'Estado inválido.');
    cambios.estado = body.estado;
  }
  if (body.programa !== undefined) {
    if (body.programa !== null && typeof body.programa !== 'string') throw new HttpError(400, 'Programa inválido.');
    cambios.programa = texto(body.programa, 120) || null;
  }
  if (body.ambito !== undefined) {
    if (!Array.isArray(body.ambito) || body.ambito.length > 30 || body.ambito.some((a) => typeof a !== 'string')) {
      throw new HttpError(400, 'Ámbito inválido.');
    }
    cambios.ambito = body.ambito.map((a) => texto(a, 80)).filter(Boolean);
  }
  if (Object.keys(cambios).length === 0) throw new HttpError(400, 'No hay cambios que guardar.');

  const { data, error } = await sb
    .from('profiles')
    .update(cambios)
    .eq('id', id)
    .select('id,rol,estado,programa,ambito,moodle_user_id')
    .maybeSingle();
  if (error) throw error;

  const antes = {};
  Object.keys(cambios).forEach((k) => { antes[k] = objetivo[k]; });
  const { error: errAudit } = await sb.from('audit_log').insert({
    actor: actor.id,
    actor_rol: actor.rol,
    accion: 'usuario_actualizado',
    objetivo: id,
    antes,
    despues: cambios,
  });
  if (errAudit) console.error('audit_log:', errAudit.message);

  res.json({ ok: true, perfil: data });
}));

// El estudiante solicita inscripción a un curso: el precio sale de la base de datos, no del cliente
app.post('/api/tramites/inscripcion', auth, limiteEscritura, ah(async (req, res) => {
  if (req.user.estado !== 'Activo' || req.user.rol !== 'estudiante') {
    throw new HttpError(403, 'Solo estudiantes activos pueden solicitar inscripción.');
  }
  const curso_id = exigirId((req.body || {}).curso_id, 'curso_id');

  const { data: curso } = await sb
    .from('cursos')
    .select('id,nombre,precio,activo,moodle_course_id')
    .eq('id', curso_id)
    .maybeSingle();
  if (!curso || !curso.activo || !curso.moodle_course_id) throw new HttpError(404, 'Curso no disponible.');

  const [{ data: mat }, { data: abierta }] = await Promise.all([
    sb.from('matriculas').select('id').eq('user_id', req.user.id).eq('curso_id', curso_id).maybeSingle(),
    sb
      .from('tramites')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('tipo', TIPO_INSCRIPCION)
      .eq('curso_id', curso_id)
      .in('estado', ['Solicitado', 'En proceso'])
      .maybeSingle(),
  ]);
  if (mat) throw new HttpError(409, 'Ya estás inscrito en este curso.');
  if (abierta) throw new HttpError(409, 'Ya tienes una solicitud abierta para este curso.');

  const { error } = await sb.from('tramites').insert([
    { user_id: req.user.id, tipo: TIPO_INSCRIPCION, detalle: curso.nombre, curso_id: curso.id, monto: curso.precio ?? null },
  ]);
  if (error) throw error;
  res.json({ ok: true });
}));

// Resuelve una solicitud de inscripción: aprobar (matricula + Moodle) o rechazar
app.post('/api/tramites/:id/resolver', auth, soloAdmin, limiteEscritura, ah(async (req, res) => {
  const id = exigirId(req.params.id, 'id');
  const accion = (req.body || {}).accion;
  if (!['aprobar', 'rechazar'].includes(accion)) throw new HttpError(400, 'Acción inválida.');

  const { data: t } = await sb
    .from('tramites')
    .select('id,user_id,tipo,estado,curso_id')
    .eq('id', id)
    .maybeSingle();
  if (!t || t.tipo !== TIPO_INSCRIPCION) throw new HttpError(404, 'Solicitud no encontrada.');
  if (!['Solicitado', 'En proceso'].includes(t.estado)) throw new HttpError(409, 'Esta solicitud ya fue resuelta.');

  if (accion === 'rechazar') {
    const { error } = await sb
      .from('tramites')
      .update({ estado: 'Rechazado', respuesta: 'Solicitud de inscripción rechazada.' })
      .eq('id', id);
    if (error) throw error;
    return res.json({ ok: true });
  }

  if (!t.curso_id) throw new HttpError(400, 'El curso de esta solicitud ya no existe. Rechaza la solicitud.');

  const { id: matriculaId } = await crearMatricula(t.user_id, t.curso_id);

  let aviso = null;
  const { data: m } = await sb.from('matriculas').select(MATRICULA_SELECT).eq('id', matriculaId).maybeSingle();
  if (!m?.curso?.moodle_course_id) {
    aviso = 'El curso no tiene ID de Moodle.';
  } else {
    try {
      await sincronizarMatricula(m);
    } catch (e) {
      aviso = e.message;
    }
  }

  const { error } = await sb
    .from('tramites')
    .update({ estado: 'Entregado', respuesta: 'Acceso otorgado al curso.' })
    .eq('id', id);
  if (error) throw error;
  res.json({ ok: true, aviso });
}));

// Elimina un usuario (solo Superadministrador)
app.delete('/api/users/:id', auth, requireRol('superadmin'), limiteEscritura, ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'id');

  if (id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta.');

  const { data: objetivo } = await sb
    .from('profiles')
    .select('id,email,nombre,apellidos,rol,estado,programa,moodle_user_id')
    .eq('id', id)
    .maybeSingle();

  if (!objetivo) throw new HttpError(404, 'Usuario no encontrado.');
  if (objetivo.rol === 'superadmin') {
    throw new HttpError(400, 'No se puede eliminar a un Superadministrador. Cámbiale el rol primero.');
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
      console.error('delete user (moodle):', e.message);
      moodleResultado = 'error';
      moodleAviso = 'No se pudo suspender la cuenta en Moodle.';
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
  if (errAuth) {
    console.error('deleteUser:', errAuth.message);
    throw new HttpError(500, 'Se borró el perfil, pero no la cuenta de acceso. Avisa al administrador técnico.');
  }

  res.json({ ok: true, moodle: moodleResultado, moodle_aviso: moodleAviso });
}));

// Rutas inexistentes
app.use((req, res) => res.status(404).json({ error: 'No encontrado.' }));

app.listen(PORT, () => console.log(`Backend IINICIA escuchando en http://localhost:${PORT}`));
