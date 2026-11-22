export const TEMAS = [
  {
    id: 'cursos',
    titulo: 'Cursos disponibles',
    icon: 'cap',
    publico: true,
    palabras: ['curso', 'cursos', 'oferta', 'programas', 'materias'],
    texto: (ctx) =>
      ctx.cursos && ctx.cursos.length
        ? 'Estos son los cursos activos actualmente:\n' +
          ctx.cursos.map((c) => `• ${c.nombre}${c.programa ? ` (${c.programa})` : ''}`).join('\n')
        : 'Por el momento no hay cursos activos publicados.',
    accion: () => ({ tab: 'services', label: 'Solicitar inscripción' }),
  },
  {
    id: 'registro',
    titulo: 'Cómo crear mi cuenta',
    icon: 'user',
    soloInvitado: true,
    palabras: ['registro', 'registrarme', 'crear cuenta', 'cuenta nueva', 'aspirante'],
    texto: () =>
      'Ve a "Registrarme", ingresa tu correo y una contraseña. Al registrarte quedas como Aspirante; un administrador revisará tu solicitud y te asignará tu rol y programa antes de darte acceso completo.',
  },
  {
    id: 'login',
    titulo: 'Iniciar sesión y verificación en dos pasos',
    icon: 'login',
    soloInvitado: true,
    palabras: ['login', 'iniciar sesion', 'entrar', 'contraseña', 'password', '2fa', 'dos pasos', 'autenticador', 'google authenticator'],
    texto: () =>
      'Inicia sesión con tu correo y contraseña. Tu cuenta usa verificación en dos pasos (2FA): necesitarás el código de una app como Google Authenticator además de tu contraseña. Si no la has configurado, el sistema te guía la primera vez.',
  },
  {
    id: 'calificaciones',
    titulo: 'Ver mi calificación',
    icon: 'book',
    roles: ['estudiante', 'profesor'],
    palabras: ['calificacion', 'calificaciones', 'nota', 'notas', 'avance'],
    texto: () => 'Puedes ver tu calificación por curso en "Mi IINICIA" o en "Mis cursos", en la tabla de tus cursos matriculados.',
    accion: () => ({ tab: 'dashboard', label: 'Ir a Mi IINICIA' }),
  },
  {
    id: 'tramites',
    titulo: 'Solicitar inscripción a un curso',
    icon: 'file',
    roles: ['estudiante'],
    palabras: ['inscribirme', 'inscripcion', 'tramite', 'tramites', 'solicitud', 'solicitar curso'],
    texto: () => 'Ve a "Trámites" y elige el curso al que quieres inscribirte. Tu solicitud queda pendiente hasta que un administrador la apruebe.',
    accion: () => ({ tab: 'services', label: 'Ir a Trámites' }),
  },
  {
    id: 'campus',
    titulo: 'Entrar al campus (Moodle)',
    icon: 'layers',
    roles: ['estudiante', 'profesor'],
    palabras: ['campus', 'moodle', 'entrar al curso', 'acceso al curso'],
    texto: () => 'Desde "Mis cursos" o "Mi IINICIA" puedes entrar directo a tu curso en Moodle. Si es tu primer acceso, te mostramos tu contraseña inicial una sola vez.',
    accion: () => ({ tab: 'courses', label: 'Ir a Mis cursos' }),
  },
  {
    id: 'usuarios',
    titulo: 'Autorizar usuarios y solicitudes',
    icon: 'users',
    roles: ['superadmin', 'administrador', 'coordinador'],
    palabras: ['usuario', 'usuarios', 'autorizar', 'rol', 'roles', 'solicitudes pendientes'],
    texto: () => 'En "Usuarios y roles" puedes revisar solicitudes pendientes, autorizar cuentas y asignar rol, estado y programa.',
    accion: () => ({ tab: 'users', label: 'Ir a Usuarios y roles' }),
  },
  {
    id: 'inscripciones',
    titulo: 'Aprobar inscripciones a cursos',
    icon: 'clipboard',
    roles: ['superadmin', 'administrador'],
    palabras: ['aprobar inscripcion', 'matricula', 'matriculas', 'inscripciones'],
    texto: () => 'En "Inscripciones" puedes aprobar o rechazar solicitudes; al aprobar, se crea la matrícula y se sincroniza con Moodle automáticamente.',
    accion: () => ({ tab: 'enrollment', label: 'Ir a Inscripciones' }),
  },
];

const normalizar = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function temasVisibles(temas, { session, rol, can }) {
  return temas.filter((t) => {
    if (t.soloInvitado) return !session;
    if (!session) return !!t.publico;
    if (t.roles && !t.roles.includes(rol)) return false;
    if (t.accion && can && !can(t.accion().tab)) return false;
    return true;
  });
}

export function buscarTema(temas, consulta) {
  const q = normalizar(consulta);
  if (!q) return null;
  let mejor = null;
  let mejorPuntaje = 0;
  for (const t of temas) {
    let puntaje = 0;
    const tit = normalizar(t.titulo);
    if (tit.includes(q) || q.includes(tit)) puntaje += 2;
    for (const p of t.palabras || []) {
      const np = normalizar(p);
      if (q.includes(np)) puntaje += 2;
      else if (np.includes(q) && q.length > 2) puntaje += 1;
    }
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = t;
    }
  }
  return mejor;
}