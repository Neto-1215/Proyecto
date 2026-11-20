import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';
import './ChatBubble.css';

const MENSAJE_BIENVENIDA = {
  rol: 'bot',
  texto: '¡Hola! Soy el asistente de IINICIA. Puedo ayudarte con dudas sobre trámites, inscripción a cursos, verificación en dos pasos o acceso a Moodle.',
};

export default function ChatBubble() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState([MENSAJE_BIENVENIDA]);
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState('');
  const finRef = useRef(null);

  useEffect(() => {
    if (abierto) finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, abierto, cargando]);

  const enviar = async (e) => {
    e.preventDefault();
    const mensaje = texto.trim();
    if (!mensaje || cargando) return;

    setMensajes((m) => [...m, { rol: 'user', texto: mensaje }]);
    setTexto('');
    setErr('');
    setCargando(true);
    try {
      const { respuesta } = await api('/api/chat', { method: 'POST', body: { mensaje } });
      setMensajes((m) => [...m, { rol: 'bot', texto: respuesta }]);
    } catch (e) {
      setErr(e.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="chatbot">
      {abierto && (
        <div className="chatbot__panel" role="dialog" aria-label="Asistente IINICIA">
          <div className="chatbot__header">
            <span>Asistente IINICIA</span>
            <button className="chatbot__cerrar" onClick={() => setAbierto(false)} aria-label="Cerrar chat">
              ✕
            </button>
          </div>

          <div className="chatbot__mensajes">
            {mensajes.map((m, i) => (
              <div key={i} className={`chatbot__burbuja chatbot__burbuja--${m.rol}`}>
                {m.texto}
              </div>
            ))}
            {cargando && <div className="chatbot__burbuja chatbot__burbuja--bot chatbot__escribiendo">Escribiendo…</div>}
            {err && <div className="chatbot__error">{err}</div>}
            <div ref={finRef} />
          </div>

          <form className="chatbot__form" onSubmit={enviar}>
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escribe tu pregunta…"
              maxLength={500}
              disabled={cargando}
            />
            <button type="submit" disabled={cargando || !texto.trim()}>
              Enviar
            </button>
          </form>
        </div>
      )}

      <button
        className="chatbot__boton"
        onClick={() => setAbierto((a) => !a)}
        aria-label={abierto ? 'Cerrar chat' : 'Abrir chat de ayuda'}
      >
        {abierto ? '✕' : '💬'}
      </button>
    </div>
  );
}