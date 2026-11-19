import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { canAccessTab, normalizeRol } from '../lib/permissions';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef(null);

  const loadProfile = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,nombre,apellidos,rol,estado,programa,ambito,moodle_user_id,created_at')
      .eq('id', userId)
      .maybeSingle();
    if (error) console.error('No se pudo cargar el perfil:', error.message);
    setProfile(data || null);
  }, []);

  useEffect(() => {
    let activo = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!activo) return;
      const s = data.session;
      setSession(s);
      if (s) {
        if (!userIdRef.current) userIdRef.current = s.user.id;
        await loadProfile(s.user.id);
      }
      if (activo) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      const uid = newSession?.user?.id ?? null;

      if (!uid) {
        userIdRef.current = null;
        setProfile(null);
        setLoading(false);
        return;
      }
      // Solo recarga el perfil si cambió el usuario (evita parpadeos al volver a la pestaña)
      if (uid !== userIdRef.current || event === 'USER_UPDATED') {
        userIdRef.current = uid;
        setLoading(true);
        setTimeout(() => loadProfile(uid).finally(() => setLoading(false)), 0);
      }
    });

    return () => {
      activo = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Sin perfil o rol desconocido: el rol más bajo (mínimo privilegio)
  const rol = session ? normalizeRol(profile?.rol) : null;
  const estado = profile?.estado || null;
  const suspended = estado === 'Suspendido';

  const can = useCallback(
    (tab) => !suspended && canAccessTab(rol, tab),
    [rol, suspended]
  );

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = {
    session,
    user: session?.user || null,
    profile,
    rol,
    estado,
    suspended,
    loading,
    can,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
};