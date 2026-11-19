import React, { useState, useEffect, useRef } from 'react';
import { supabase, clienteTemporal } from '../lib/supabase';

const traducirError = (msg = '') => {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (m.includes('already registered')) return 'No se pudo completar el registro. Si ya tienes cuenta, inicia sesión.';
  if (m.includes('email not confirmed')) return 'Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja.';
  if (m.includes('password should be at least')) return 'La contraseña es demasiado corta.';
  if (m.includes('totp') || m.includes('mfa') || m.includes('verification failed')) {
    return 'Código incorrecto o vencido. Revisa el código actual de tu app.';
  }
  if (m.includes('rate limit')) return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
  return msg;
};

const AuthForm = ({ initialMode = 'login', onModeChange, onLoginSuccess }) => {
  const [isSignUp, setIsSignUp] = useState(initialMode === 'register');
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Doble autenticación (app autenticadora)
  const [paso, setPaso] = useState('credenciales'); // 'credenciales' | 'enrolar' | 'codigo'
  const [codigo, setCodigo] = useState('');
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secreto, setSecreto] = useState('');
  const clienteRef = useRef(null); // cliente temporal con la sesión a medias

  useEffect(() => {
    const next = initialMode === 'register';
    if (next !== isSignUp) {
      setIsSignUp(next);
      setMessage('');
      setError('');
      reiniciarMfa();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode]);

  const reiniciarMfa = () => {
    clienteRef.current = null;
    setPaso('credenciales');
    setCodigo('');
    setFactorId('');
    setQr('');
    setSecreto('');
  };

  const cambiarModo = (registro) => {
    setIsSignUp(registro);
    setMessage('');
    setError('');
    reiniciarMfa();
    if (onModeChange) onModeChange(registro ? 'register' : 'login');
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setMessage('');
    setError('');

    if (isSignUp) {
      if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
        setError('La contraseña debe tener al menos 10 caracteres, con mayúsculas, minúsculas y números.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden.');
        return;
      }
    }

    setLoading(true);

    try {
      if (isSignUp) {
        // El perfil (rol Aspirante, estado Pendiente) lo crea el trigger en la base de datos
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { nombre: nombre.trim(), apellidos: apellidos.trim() },
          },
        });

        if (signUpError) throw signUpError;

        setIsSignUp(false);
        if (onModeChange) onModeChange('login');
        setPassword('');
        setConfirmPassword('');
        setMessage(
          '¡Tu cuenta se registró correctamente! Inicia sesión con tu correo y contraseña para continuar. Un administrador revisará y autorizará tu acceso.'
        );
      } else {
        // 1) Valida la contraseña con un cliente temporal (no inicia sesión en el portal)
        const temporal = clienteTemporal();
        const { error: pwError } = await temporal.auth.signInWithPassword({ email, password });
        if (pwError) throw pwError;
        clienteRef.current = temporal;

        // 2) ¿Ya tiene la app autenticadora vinculada?
        const { data: factores, error: fError } = await temporal.auth.mfa.listFactors();
        if (fError) throw fError;

        const verificado = (factores?.totp || []).find((f) => f.status === 'verified');

        if (verificado) {
          setFactorId(verificado.id);
          setPaso('codigo');
        } else {
          // Limpia intentos de vinculación a medias y crea uno nuevo
          for (const f of (factores?.all || []).filter((x) => x.status === 'unverified')) {
            await temporal.auth.mfa.unenroll({ factorId: f.id });
          }
          const { data: enr, error: enrError } = await temporal.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: 'IINICIA',
            issuer: 'IINICIA',
          });
          if (enrError) throw enrError;

          setFactorId(enr.id);
          setQr(enr.totp.qr_code);
          setSecreto(enr.totp.secret);
          setPaso('enrolar');
        }

        setPassword('');
        setCodigo('');
      }
    } catch (err) {
      reiniciarMfa();
      setError(traducirError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const verificarCodigo = async (e) => {
    e.preventDefault();
    setMessage('');
    setError('');

    const limpio = codigo.replace(/\s/g, '');
    if (limpio.length !== 6) {
      setError('Escribe el código completo de 6 dígitos.');
      return;
    }

    const cliente = clienteRef.current;
    if (!cliente) {
      reiniciarMfa();
      setError('Tu sesión de verificación expiró. Inicia sesión de nuevo.');
      return;
    }

    setLoading(true);
    try {
      const { data: reto, error: retoError } = await cliente.auth.mfa.challenge({ factorId });
      if (retoError) throw retoError;

      const { data: ver, error: vError } = await cliente.auth.mfa.verify({
        factorId,
        challengeId: reto.id,
        code: limpio,
      });
      if (vError) throw vError;

      // Pasa la sesión ya verificada (nivel aal2) al cliente principal del portal
      const { error: sError } = await supabase.auth.setSession({
        access_token: ver.access_token,
        refresh_token: ver.refresh_token,
      });
      if (sError) throw sError;

      reiniciarMfa();
      if (onLoginSuccess) onLoginSuccess();
    } catch (err) {
      setError(traducirError(err.message));
      setCodigo('');
    } finally {
      setLoading(false);
    }
  };

  const campoCodigo = (
    <div className="field">
      <label htmlFor="codigo">Código de 6 dígitos</label>
      <input
        id="codigo"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
        placeholder="000000"
        required
        autoFocus
        style={{ textAlign: 'center', letterSpacing: '0.5em', fontSize: 24 }}
      />
    </div>
  );

  /* ---------- Primera vez: vincular la app autenticadora ---------- */
  if (!isSignUp && paso === 'enrolar') {
    return (
      <div className="auth">
        <h2>Activa la verificación en dos pasos</h2>
        <p className="auth__sub">
          1) Vamos a usar la app <strong>Google Authenticator</strong> para generar tu código de verificación.
          Si no la tienes instalada en tu teléfono, descárgala ahora desde la App Store o Google Play — la vas a necesitar para iniciar sesión.<br />
          2) Abre la app y escanea este código QR.<br />
          3) Escribe el código de 6 dígitos que te muestre la app.
        </p>

        {error && <div className="alert alert--error">{error}</div>}

        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          {qr && <img src={qr} alt="Código QR para la app autenticadora" width={180} height={180} />}
          {secreto && (
            <p style={{ fontSize: 12, wordBreak: 'break-all' }}>
              ¿No puedes escanear? Escribe esta clave en la app:<br />
              <code>{secreto}</code>
            </p>
          )}
        </div>

        <form onSubmit={verificarCodigo} className="auth-form">
          {campoCodigo}
          <button type="submit" disabled={loading} className="btn btn--primary btn--block auth-submit">
            {loading ? 'Verificando...' : 'Activar e ingresar'}
          </button>
        </form>

        <p className="auth-switch">
          <button type="button" onClick={() => { reiniciarMfa(); setError(''); }}>Cancelar</button>
        </p>
      </div>
    );
  }

  /* ---------- Ya vinculada: pedir el código ---------- */
  if (!isSignUp && paso === 'codigo') {
    return (
      <div className="auth">
        <h2>Verificación en dos pasos</h2>
        <p className="auth__sub">
          Abre tu app autenticadora y escribe el código de 6 dígitos de <strong>IINICIA</strong>.
        </p>

        {error && <div className="alert alert--error">{error}</div>}

        <form onSubmit={verificarCodigo} className="auth-form">
          {campoCodigo}
          <button type="submit" disabled={loading} className="btn btn--primary btn--block auth-submit">
            {loading ? 'Verificando...' : 'Verificar e ingresar'}
          </button>
        </form>

        <p className="auth-switch">
          <button type="button" onClick={() => { reiniciarMfa(); setError(''); }}>Usar otra cuenta</button>
        </p>
      </div>
    );
  }

  /* ---------- Correo y contraseña ---------- */
  return (
    <div className="auth">
      <div className="auth-tabs" role="tablist">
        <button
          type="button" role="tab" aria-selected={!isSignUp}
          className={`auth-tab ${!isSignUp ? 'active' : ''}`}
          onClick={() => cambiarModo(false)}
        >
          Iniciar sesión
        </button>
        <button
          type="button" role="tab" aria-selected={isSignUp}
          className={`auth-tab ${isSignUp ? 'active' : ''}`}
          onClick={() => cambiarModo(true)}
        >
          Registrarme
        </button>
      </div>

      <h2>{isSignUp ? 'Registro de nueva cuenta' : 'Acceso institucional'}</h2>
      <p className="auth__sub">
        {isSignUp
          ? 'Crea tus credenciales. Tu cuenta se creará como Aspirante hasta ser autorizada.'
          : 'Ingresa tu correo y contraseña institucionales.'}
      </p>

      {message && <div className="alert alert--ok">{message}</div>}
      {error && <div className="alert alert--error">{error}</div>}

      <form onSubmit={handleAuth} className="auth-form">
        {isSignUp && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="nombre">Nombre</label>
              <input
                id="nombre" type="text" value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required placeholder="Tu nombre" autoComplete="given-name"
              />
            </div>
            <div className="field">
              <label htmlFor="apellidos">Apellidos</label>
              <input
                id="apellidos" type="text" value={apellidos}
                onChange={(e) => setApellidos(e.target.value)}
                required placeholder="Tus apellidos" autoComplete="family-name"
              />
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Correo electrónico</label>
          <input
            id="email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            required placeholder="ejemplo@iinicia.edu" autoComplete="email"
          />
        </div>

        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <div className="pw-wrap">
            <input
              id="password" type={showPw ? 'text' : 'password'} value={password}
              onChange={(e) => setPassword(e.target.value)}
              required placeholder="••••••••"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
            <button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)}>
              {showPw ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        {isSignUp && (
          <div className="field">
            <label htmlFor="confirm">Confirmar contraseña</label>
            <input
              id="confirm" type={showPw ? 'text' : 'password'} value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required placeholder="Repite tu contraseña" autoComplete="new-password"
            />
          </div>
        )}

        <button type="submit" disabled={loading} className="btn btn--primary btn--block auth-submit">
          {loading ? 'Procesando...' : isSignUp ? 'Crear mi cuenta' : 'Continuar'}
        </button>
      </form>

      <p className="auth-switch">
        {isSignUp ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'}{' '}
        <button type="button" onClick={() => cambiarModo(!isSignUp)}>
          {isSignUp ? 'Inicia sesión aquí' : 'Regístrate aquí'}
        </button>
      </p>
    </div>
  );
};

export default AuthForm;