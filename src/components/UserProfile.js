import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const UserProfile = () => {
    const [userProfile, setUserProfile] = useState(null);
    const [userAuth, setUserAuth] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUserData = async () => {
            try {
                setLoading(true);

                const { data: { session } } = await supabase.auth.getSession();
                
                if (!session || !session.user) {
                    setUserAuth(null);
                    setUserProfile(null);
                    setLoading(false);
                    return;
                }

                setUserAuth(session.user);

                // Consultar la tabla 'profiles'
                let { data: profiles, error: profileError } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', session.user.id);

                if (profileError) throw profileError;

                let currentProfile = profiles && profiles.length > 0 ? profiles[0] : null;

                // El perfil lo crea el trigger de la base de datos (rol Aspirante, estado Pendiente).
                // Nunca se crea desde el navegador: asi nadie puede darse rol o estado a si mismo.

                setUserProfile(currentProfile);

            } catch (err) {
                console.error("Error al cargar el perfil:", err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchUserData();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session) {
                fetchUserData();
            } else {
                setUserAuth(null);
                setUserProfile(null);
                setLoading(false);
            }
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setUserAuth(null);
        setUserProfile(null);
    };

    if (loading) {
        return <div style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>Cargando expediente institucional...</div>;
    }

    if (!userAuth) {
        return (
            <div style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                <p style={{ fontSize: '1.1rem', marginBottom: '10px' }}>🔒 No hay ningún usuario con sesión iniciada.</p>
                <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Por favor, dirígete a la pestaña <strong>Acceso / Auth</strong> para iniciar sesión.</p>
            </div>
        );
    }

    const currentRole = userProfile?.rol || 'Estudiante';

    return (
        <div style={{ width: '100%', maxWidth: '480px', margin: '0 auto', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0, color: '#0f172a' }}>Perfil Institucional</h3>
                <span style={{ backgroundColor: '#e0e7ff', color: '#3730a3', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>
                    Rol: {currentRole}
                </span>
            </div>
            <hr style={{ border: '0', borderTop: '1px solid #e2e8f0', marginBottom: '15px' }} />
            
            {/* CAMPOS COMUNES */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', color: '#334155' }}>
                <p><strong>Correo Electrónico:</strong> {userAuth.email}</p>
                <p><strong>Nombre:</strong> {userProfile?.nombre} {userProfile?.apellidos}</p>
                <p><strong>Rol en el Sistema:</strong> <span style={{ color: '#4f46e5', fontWeight: '600' }}>{currentRole}</span></p>

                {/* VISTA CONDICIONAL SEGÚN EL ROL */}
                {currentRole === 'Administrador' && (
                    <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', padding: '12px', borderRadius: '8px', marginTop: '5px' }}>
                        <p style={{ margin: '0 0 6px 0', color: '#991b1b', fontWeight: '600' }}>Privilegios de Administrador</p>
                        <p style={{ margin: 0, fontSize: '13px', color: '#7f1d1d' }}>Acceso total de supervisión y control sobre los registros de usuarios y bases de datos.</p>
                    </div>
                )}

                {currentRole === 'Profesor' && (
                    <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '12px', borderRadius: '8px', marginTop: '5px' }}>
                        <p style={{ margin: '0 0 6px 0', color: '#166534', fontWeight: '600' }}>Datos Académicos Docentes</p>
                        <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#14532d' }}><strong>Departamento:</strong> Ingeniería y Sistemas</p>
                        <p style={{ margin: 0, fontSize: '13px', color: '#14532d' }}><strong>Cédula Docente:</strong> DOC-2026-X9</p>
                    </div>
                )}

                {(currentRole === 'Estudiante' || currentRole === 'Aspirante') && (
                    <>
                        <p><strong>Carrera:</strong> {userProfile?.carrera || 'Ingeniería Informática'}</p>
                        <p><strong>ID Moodle:</strong> <span style={{ fontFamily: 'monospace', color: '#4f46e5' }}>{userProfile?.moodle_user_id || 'MDL-2026-001'}</span></p>
                        <p><strong>Estado Escolar:</strong> {userProfile?.estado || 'Activo'}</p>
                    </>
                )}
            </div>

            <button 
                onClick={handleLogout}
                style={{ 
                    marginTop: '25px', 
                    width: '100%', 
                    padding: '10px', 
                    backgroundColor: '#ef4444', 
                    color: '#fff', 
                    border: 'none', 
                    borderRadius: '8px', 
                    fontWeight: '600', 
                    cursor: 'pointer' 
                }}
            >
                Cerrar Sesión
            </button>
        </div>
    );
};

export default UserProfile;