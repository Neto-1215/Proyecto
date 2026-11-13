export const ROLES = {
  superadmin:    { label: 'Superadministrador' },
  administrador: { label: 'Administrador' },
  coordinador:   { label: 'Coordinador' },
  profesor:      { label: 'Profesor' },
  estudiante:    { label: 'Estudiante' },
  aspirante:     { label: 'Aspirante' },
  soporte:       { label: 'Soporte' },
};

export const ESTADOS = ['Pendiente', 'Activo', 'Suspendido'];

// Acepta valores antiguos como "Estudiante" o "Superadministrador"
export const normalizeRol = (r) => {
  const v = String(r || '').toLowerCase();
  if (v === 'superadministrador') return 'superadmin';
  return ROLES[v] ? v : 'aspirante';
};

const TODOS = ['superadmin', 'administrador', 'coordinador', 'profesor', 'estudiante', 'aspirante', 'soporte'];

// Qué rol puede abrir cada sección (mínimo privilegio)
export const TAB_ACCESS = {
  dashboard:  TODOS,
  profile:    TODOS,
  services:   TODOS,
  courses:    ['superadmin', 'administrador', 'coordinador', 'profesor', 'estudiante'],
  users:      ['superadmin', 'administrador', 'coordinador', 'soporte'],
  enrollment: ['superadmin', 'administrador', 'coordinador'],
  moodle:     ['superadmin', 'administrador'],
  audit:      ['superadmin'],
};

export const canAccessTab = (rol, tab) => !!rol && (TAB_ACCESS[tab] || []).includes(rol);

// Roles que puede asignar cada rol
export const ASSIGNABLE_ROLES = {
  superadmin: Object.keys(ROLES),
  administrador: ['coordinador', 'profesor', 'estudiante', 'aspirante', 'soporte'],
};

export const canManageUsers = (rol) => ['superadmin', 'administrador'].includes(rol);
export const canManageEnrollments = (rol) => ['superadmin', 'administrador'].includes(rol);