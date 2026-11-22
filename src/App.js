import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { supabase } from './lib/supabase';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ROLES } from './lib/permissions';
import Icon from './components/Icon';
import UserProfile from './components/UserProfile';
import Dashboard from './components/Dashboard';
import AuthForm from './components/AuthForm';
import MoodleCourses from './components/MoodleCourses';
import CourseEnrollment from './components/CourseEnrollment';
import SchoolServices from './components/SchoolServices';
import AdminUsers from './components/AdminUsers';
import CourseAccess from './components/CourseAccess';
import AuditLog from './components/AuditLog';
import AssistantBubble from './components/AssistantBubble';
import InicioAssistant from './components/InicioAssistant';

/* ---------- Datos ---------- */
// Menú completo; cada rol solo ve lo que permissions.js le autoriza
const NAV = [
  { id: 'dashboard', label: 'Mi IINICIA', icon: 'book' },
  { id: 'courses', label: 'Mis cursos', icon: 'cap' },
  { id: 'users', label: 'Usuarios y roles', icon: 'users' },
  { id: 'enrollment', label: 'Inscripciones', icon: 'clipboard' },
  { id: 'services', label: 'Trámites', icon: 'file' },
  { id: 'moodle', label: 'API de Moodle', icon: 'layers' },
  { id: 'audit', label: 'Auditoría', icon: 'eye' },
  { id: 'profile', label: 'Perfil Supabase', icon: 'shield' },
];

const PAGE_INFO = {
  auth: { title: 'Acceso institucional', desc: 'Ingresa con tu cuenta para continuar.' },
  dashboard: { title: 'Mi IINICIA', desc: 'Tu panel personal con tu actividad y tu avance.' },
  courses: { title: 'Mis cursos', desc: 'Cursos y matrículas autorizados para tu rol.' },
  users: { title: 'Usuarios y roles', desc: 'Gestión de usuarios dentro de tu ámbito de autorización.' },
  enrollment: { title: 'Inscripciones', desc: 'Autoriza solicitudes de admisión y da seguimiento a las matrículas.' },
  services: { title: 'Trámites', desc: 'Gestiona tus servicios y solicitudes escolares.' },
  moodle: { title: 'API de Moodle', desc: 'Integración técnica con la plataforma Moodle.' },
  audit: { title: 'Auditoría', desc: 'Registro de cambios en usuarios, roles y estados.' },
  profile: { title: 'Perfil Supabase', desc: 'Datos y seguridad de tu cuenta.' },
};

const REGISTER_INFO = {
  title: 'Crear cuenta',
  desc: 'Regístrate para comenzar tu experiencia en IINICIA.',
};

const WIDE_PAGES = ['dashboard', 'users', 'courses', 'audit', 'enrollment'];

const CELLS = [
  { tab: 'dashboard', icon: 'book', title: 'Mi IINICIA', text: 'Tu panel con avance, actividades y novedades.', cta: 'Entrar' },
  { tab: 'courses', icon: 'cap', title: 'Mis cursos', text: 'Cursos y matrículas autorizados para tu rol.', cta: 'Ver cursos' },
  { tab: 'users', icon: 'users', title: 'Usuarios y roles', text: 'Gestión de usuarios dentro de tu ámbito.', cta: 'Gestionar' },
  { tab: 'enrollment', icon: 'clipboard', title: 'Inscripciones', text: 'Acciones académicas e inscripciones.', cta: 'Abrir' },
  { tab: 'services', icon: 'file', title: 'Trámites', text: 'Constancias y servicios escolares.', cta: 'Gestionar' },
  { tab: 'moodle', icon: 'layers', title: 'API de Moodle', text: 'Integración técnica con el campus.', cta: 'Abrir' },
  { tab: 'audit', icon: 'eye', title: 'Auditoría', text: 'Cambios de usuarios, roles y estados.', cta: 'Revisar' },
  { tab: 'profile', icon: 'shield', title: 'Mi perfil', text: 'Tus datos y la seguridad de tu cuenta.', cta: 'Ver perfil' },
];

const VARIANTS = ['cell--dark', '', 'cell--blue'];

const STEPS = [
  { n: 1, title: 'Crea tu cuenta', text: 'Regístrate con tu correo y quedarás como aspirante.' },
  { n: 2, title: 'Recibe tu autorización', text: 'Un administrador revisa tu solicitud y te asigna tu rol y programa.' },
  { n: 3, title: 'Aprende a tu ritmo', text: 'Accede a los cursos en los que tengas matrícula válida.' },
];

function Shell() {
  const { session, user, profile, rol, estado, suspended, loading, can } = useAuth();

  const [activeTab, setActiveTab] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [menuOpen, setMenuOpen] = useState(false);
  const [avisos, setAvisos] = useState(0);
  const menuRef = useRef(null);

  // Cierra el menú de usuario al hacer clic fuera
  useEffect(() => {
    if (!menuOpen) return undefined;
    const fuera = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [menuOpen]);

  // Solicitudes pendientes para la campana (solo quien puede gestionar usuarios)
  const puedeUsuarios = !!session && !suspended && can('users');
  useEffect(() => {
    if (!puedeUsuarios) { setAvisos(0); return undefined; }
    let vivo = true;
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'Pendiente')
      .then(({ count }) => { if (vivo) setAvisos(count || 0); });
    return () => { vivo = false; };
  }, [puedeUsuarios, activeTab]);

  // Si la sección ya no corresponde al rol (cierre de sesión, cambio de rol), vuelve al inicio
  useEffect(() => {
    if (!loading && activeTab && activeTab !== 'auth' && !can(activeTab)) {
      setActiveTab(null);
    }
  }, [loading, activeTab, can]);

  const go = (tab) => {
    setActiveTab(tab);
    setSideOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goAuth = (mode) => {
    setAuthMode(mode);
    go('auth');
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    await supabase.auth.signOut();
    go(null);
  };

  const displayName = profile?.nombre
    ? `${profile.nombre} ${profile.apellidos || ''}`.trim()
    : user?.email || '';
  const userInitial = displayName ? displayName.charAt(0).toUpperCase() : '?';
  const rolLabel = rol ? ROLES[rol].label : '';

  const showLoading = loading && activeTab && activeTab !== 'auth';
  const view = activeTab && (activeTab === 'auth' || can(activeTab)) ? activeTab : null;
  const info = view
    ? view === 'auth' && authMode === 'register' ? REGISTER_INFO : PAGE_INFO[view]
    : null;

  const navVisible = NAV.filter((n) => can(n.id));
  const cellsVisible = CELLS.filter((c) => can(c.tab));
  const pendiente = session && !suspended && (rol === 'aspirante' || estado === 'Pendiente');

  return (
    <div className="shell">
      {/* ============ SIDEBAR ============ */}
      <aside className={`sidebar ${sideOpen ? 'open' : ''}`}>
        <img src="/Logo.png" alt="IINICIA" className="sidebar__logo" onClick={() => go(null)} />

        <span className="sidebar__label">Menú</span>
        <nav className="sidebar__nav">
          <button className={`side-link ${activeTab === null ? 'active' : ''}`} onClick={() => go(null)}>
            <Icon name="home" /> Inicio
          </button>
          {navVisible.map((item) => (
            <button
              key={item.id}
              className={`side-link ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => go(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar__foot">
          {!loading && (
            session ? (
              <>
                <div className="user-card">
                  <span className="user-card__avatar">{userInitial}</span>
                  <div>
                    <small>{rolLabel}</small>
                    <strong title={user?.email}>{displayName}</strong>
                  </div>
                </div>
                
              </>
            ) : null
          )}
          <small className="sidebar__inst">IINICIA © 2026. Todos los derechos reservados.</small>
        </div>
      </aside>
      {sideOpen && <div className="scrim" onClick={() => setSideOpen(false)} />}

      {/* ============ MAIN ============ */}
      <div className="main">
        <header className="topbar">
          <button className="topbar__menu" aria-label="Abrir menú" onClick={() => setSideOpen(!sideOpen)}>
            <Icon name={sideOpen ? 'close' : 'menu'} />
          </button>
          <div className="crumbs">
            <button className="crumbs__home" aria-label="Inicio" onClick={() => go(null)}>
              <Icon name="home" />
            </button>
            <i>/</i>
            <span>Universidad IINICIA</span>
            <i>/</i>
            <strong>{info ? info.title : 'Inicio'}</strong>
          </div>

          <div className="topbar__actions">
            {!loading && (
              session ? (
                <>
                  {puedeUsuarios && (
                    <button
                      className="bell"
                      aria-label={`Solicitudes pendientes: ${avisos}`}
                      onClick={() => go('users')}
                    >
                      <Icon name="bell" />
                      {avisos > 0 && <b>{avisos > 99 ? '99+' : avisos}</b>}
                    </button>
                  )}
                  <div className="usermenu" ref={menuRef}>
                    <button
                      className="topbar__user"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      title={user?.email}
                      onClick={() => setMenuOpen(!menuOpen)}
                    >
                      <span className="topbar__avatar">{userInitial}</span>
                      <span className="topbar__name">{displayName}</span>
                      <Icon name="chevron" />
                    </button>
                    {menuOpen && (
                      <div className="usermenu__panel" role="menu">
                        <div className="usermenu__head">
                          <strong>{displayName}</strong>
                          <small>{rolLabel}</small>
                        </div>
                        {can('profile') && (
                          <button role="menuitem" onClick={() => { setMenuOpen(false); go('profile'); }}>
                            <Icon name="shield" /> Mi perfil
                          </button>
                        )}
                        <button role="menuitem" onClick={handleLogout}>
                          <Icon name="logout" /> Cerrar sesión
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="usermenu" ref={menuRef}>
                  <button
                    className="topbar__user topbar__user--guest"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label="Iniciar sesión o registrarme"
                    onClick={() => setMenuOpen(!menuOpen)}
                  >
                    <Icon name="user" />
                  </button>
                  {menuOpen && (
                    <div className="usermenu__panel" role="menu">
                      <button role="menuitem" onClick={() => { setMenuOpen(false); goAuth('login'); }}>
                        <Icon name="login" /> Iniciar sesión
                      </button>
                      <button role="menuitem" onClick={() => { setMenuOpen(false); goAuth('register'); }}>
                        <Icon name="user" /> Registrarme
                      </button>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </header>

        <div className="content">
          {suspended && (
            <div className="alert alert--error banner">
              Tu cuenta está suspendida. Contacta a soporte para reactivarla.
            </div>
          )}
          {pendiente && (
            <div className="alert alert--info banner">
              Tu cuenta está pendiente de autorización. No tendrás acceso a cursos hasta que un administrador te autorice.
            </div>
          )}

          {showLoading ? (
            <section className="page">
              <div className="page-card"><div className="empty">Cargando…</div></div>
            </section>
          ) : view ? (
            /* ---------- PÁGINAS INTERNAS ---------- */
            <section className={`page ${WIDE_PAGES.includes(view) ? 'page--wide' : ''}`}>
              {view === 'dashboard' ? (
                <Dashboard onNavigate={go} />
              ) : (
                <>
                  <div className="page-head">
                    <h1>{info.title}</h1>
                    <p>{info.desc}</p>
                  </div>
                  <div className="page-card">
                    {view === 'auth' && (
                      <AuthForm
                        initialMode={authMode}
                        onModeChange={setAuthMode}
                        onLoginSuccess={() => go('dashboard')}
                      />
                    )}
                    {view === 'courses' && <CourseAccess />}
                    {view === 'users' && <AdminUsers />}
                    {view === 'enrollment' && <CourseEnrollment onNavigate={go} />}
                    {view === 'services' && <SchoolServices />}
                    {view === 'moodle' && <MoodleCourses />}
                    {view === 'audit' && <AuditLog />}
                    {view === 'profile' && <UserProfile />}
                  </div>
                </>
              )}
            </section>
          ) : (
            /* ---------- INICIO ---------- */
            <>
              <section className="hero">
                <div className="hero__text">
                  <span className="chip"><i /> Universidad IINICIA</span>
                  <h1>
                    Tu educación comienza hoy, <span>estés donde estés.</span>
                  </h1>
                  <p>El conocimiento que transforma tu vida está a tu alcance, en todo momento.</p>
                  <div className="hero__actions">
                    {session ? (
                      <>
                        <button className="btn btn--primary" onClick={() => go('dashboard')} disabled={!can('dashboard')}>
                          Ir a Mi IINICIA <Icon name="arrow" />
                        </button>
                        {can('courses') && (
                          <button className="btn btn--light" onClick={() => go('courses')}>
                            Mis cursos
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button className="btn btn--primary" onClick={() => goAuth('register')}>
                          Crear mi cuenta <Icon name="arrow" />
                        </button>
                        <button className="btn btn--light" onClick={() => goAuth('login')}>
                          Iniciar sesión
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Tarjetas decorativas (ejemplo visual) */}
                <div className="visual" aria-hidden="true">
                  <div className="blob" />
                  <div className="float-card fc-a">
                    <small>Mi progreso</small>
                    <strong>Curso de ejemplo</strong>
                    <div className="bar"><b style={{ width: '72%' }} /></div>
                    <em>72% completado</em>
                  </div>
                  <div className="float-card fc-b">
                    <span className="pulse" />
                    <div>
                      <strong>Nueva lección</strong>
                      <small>Ya disponible en tu aula</small>
                    </div>
                  </div>
                  <div className="float-card fc-c">
                    <span className="badge-ok"><Icon name="check" /></span>
                    <div>
                      <strong>Constancia lista</strong>
                      <small>Descárgala en Trámites</small>
                    </div>
                  </div>
                </div>
              </section>
              
              <InicioAssistant onNavigate={go} />

              {/* BENTO: solo lo que el rol puede usar */}
              {!loading && (
                <section className="block">
                  <span className="eyebrow">{session ? rolLabel : 'Tu espacio'}</span>
                  <h2>{session ? 'Lo que puedes hacer en tu portal' : 'Empieza hoy en IINICIA'}</h2>

                  <div className="bento">
                    {session ? (
                      cellsVisible.map((c, i) => (
                        <button
                          key={c.tab}
                          className={`cell c-third ${VARIANTS[i % 3]}`}
                          onClick={() => go(c.tab)}
                        >
                          <span className="cell__icon"><Icon name={c.icon} /></span>
                          <h3>{c.title}</h3>
                          <p>{c.text}</p>
                          <span className="cell__go">{c.cta} <Icon name="arrow" /></span>
                        </button>
                      ))
                    ) : (
                      <>
                        <button className="cell cell--dark c-wide" onClick={() => goAuth('register')}>
                          <span className="cell__icon"><Icon name="user" /></span>
                          <h3>Crea tu cuenta</h3>
                          <p>Regístrate con tu correo y comienza tu proceso de admisión.</p>
                          <span className="cell__go">Registrarme <Icon name="arrow" /></span>
                        </button>
                        <button className="cell c-wide" onClick={() => goAuth('login')}>
                          <span className="cell__icon"><Icon name="login" /></span>
                          <h3>Ya tengo cuenta</h3>
                          <p>Accede a tu panel, tus cursos y tus trámites.</p>
                          <span className="cell__go">Iniciar sesión <Icon name="arrow" /></span>
                        </button>
                      </>
                    )}
                  </div>
                </section>
              )}

              {/* PASOS (solo visitantes) */}
              {!session && !loading && (
                <section className="block block--steps">
                  <span className="eyebrow">Cómo empezar</span>
                  <h2>Empieza en 3 pasos</h2>
                  <div className="steps">
                    {STEPS.map((s) => (
                      <div className="step" key={s.n}>
                        <span className="step__n">{s.n}</span>
                        <h3>{s.title}</h3>
                        <p>{s.text}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="site-foot">
          <span>UNIVERSIDAD IINICIA &copy; 2026</span>
          <span>Instituto de Innovación y Ciencias Aplicadas &bull; Entorno de Pruebas</span>
        </footer>
      </div>

      {!suspended && view !== null && <AssistantBubble onNavigate={go} />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}