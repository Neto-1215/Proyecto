const crypto = require('crypto');

const MOODLE_URL = (process.env.MOODLE_URL || '').replace(/\/$/, '');
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

const ROLES_MOODLE = {
  student: Number(process.env.MOODLE_ROLE_STUDENT || 5),
  teacher: Number(process.env.MOODLE_ROLE_TEACHER || 3), // editingteacher ("Teacher" en Moodle)
};

// Convierte { users: [{ username: 'a' }] } en users[0][username]=a
function aplanar(obj, usp, prefijo = '') {
  Object.entries(obj).forEach(([k, v]) => {
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (v !== null && typeof v === 'object') aplanar(v, usp, clave);
    else usp.append(clave, String(v));
  });
}

async function moodle(funcion, params = {}) {
  if (!MOODLE_URL || !MOODLE_TOKEN) {
    throw new Error('Faltan MOODLE_URL o MOODLE_TOKEN en el .env del backend');
  }

  const body = new URLSearchParams({
    wstoken: MOODLE_TOKEN,
    wsfunction: funcion,
    moodlewsrestformat: 'json',
  });
  aplanar(params, body);

  let res;
  try {
    res = await fetch(`${MOODLE_URL}/webservice/rest/server.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000), // evita que una respuesta colgada bloquee el backend
    });
  } catch {
    throw new Error('No se pudo conectar con Moodle (¿está encendido Apache en XAMPP?)');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Moodle devolvió una respuesta que no es JSON válido');
  }
  if (data && data.exception) throw new Error(`Moodle: ${data.message} (${data.errorcode})`);
  return data;
}

// Contraseña aleatoria que cumple la política por defecto de Moodle
const generarPassword = () => `${crypto.randomBytes(9).toString('base64url')}Aa1!`;

// Busca al usuario en Moodle por correo; si no existe, lo crea. Devuelve su ID de Moodle.
async function asegurarUsuarioMoodle(perfil) {
  const email = String(perfil.email || '').toLowerCase();
  if (!email) throw new Error('El perfil no tiene correo');

  const encontrados = await moodle('core_user_get_users_by_field', { field: 'email', values: [email] });
  if (Array.isArray(encontrados) && encontrados.length > 0) return encontrados[0].id;

  const creados = await moodle('core_user_create_users', {
    users: [
      {
        username: email,
        password: generarPassword(),
        firstname: perfil.nombre || 'Nuevo',
        lastname: perfil.apellidos || 'Usuario',
        email,
        auth: 'manual',
      },
    ],
  });
  return creados[0].id;
}

module.exports = { moodle, asegurarUsuarioMoodle, ROLES_MOODLE };
