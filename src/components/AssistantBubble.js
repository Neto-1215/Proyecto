import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';
import { TEMAS, temasVisibles, buscarTema } from '../lib/asistente';
import './AssistantBubble.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';

const BIENVENIDA = {
  rol: 'bot',
  texto: '¡Hola! Soy el asistente de IINICIA. Escribe tu duda o elige un tema:',
};

export default function AssistantBubble({ onNavigate }) {
  const { session, rol, can } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState([BIENVENIDA]);
  const [texto, setTexto] = useState('');
  const [cursos, setCursos] = useState([]);
  const finRef = useRef(null);

  const visibles = useMemo(() => temasVisibles(TEMAS, { session, rol, can }), [session, rol, can]);

  useEffect(() => {
    if (!abierto) return;
    fetch(`${API}/api/asistente/contexto`)
      .then((r) => r.json())
      .then((d) => setCursos(d.cursos || []))
      .catch(() => {});
  }, [abierto]);

  useEffect(() => {
    if (abierto) finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, abierto]);

  const responderConTema = (tema) => {
    const accion = tema.accion ? tema.accion() : null;
    setMensajes((m) => [...m, { rol: 'bot', texto: tema.texto({ cursos }), accion }]);
  };

  const enviar = (e) => {
    e.preventDefault();
    const mensaje = texto.trim();
    if (!mensaje) return;
    setMensajes((m) => [...m, { rol: 'user', texto: mensaje }]);
    setTexto('');

    const tema = buscarTema(visibles, mensaje);
    if (tema) {
      responderConTema(tema);
    } else {
      setMensajes((m) => [
        ...m,
        {
          rol: 'bot',
          texto: 'No encontré algo exacto para eso. Elige uno de estos temas:',
          chips: visibles,
        },
      ]);
    }
  };

  const elegirChip = (tema) => {
    setMensajes((m) => [...m, { rol: 'user', texto: tema.titulo }]);
    responderConTema(tema);
  };

  const ir = (tab) => {
    onNavigate(tab);
    setAbierto(false);
  };

  return (
    <div className="asistente">
      {abierto && (
        <div className="asistente__panel" role="dialog" aria-label="Asistente IINICIA">
          <div className="asistente__header">
            <span>Asistente IINICIA</span>
            <button className="asistente__cerrar" onClick={() => setAbierto(false)} aria-label="Cerrar asistente">
              ✕
            </button>
          </div>

          <div className="asistente__cuerpo">
            <div className="asistente__burbuja asistente__burbuja--bot">
              <p>¡Hola! Soy el asistente de IINICIA. Escribe tu duda o elige un tema:</p>
              <div className="asistente__chips">
                {visibles.map((t) => (
                  <button key={t.id} className="asistente__chip" onClick={() => elegirChip(t)}>
                    {t.titulo}
                  </button>
                ))}
              </div>
            </div>
            {mensajes.map((m, i) => (
              <div key={i} className={`asistente__burbuja asistente__burbuja--${m.rol}`}>
                <p>{m.texto}</p>
                {m.accion && (
                  <button className="asistente__accion" onClick={() => ir(m.accion.tab)}>
                    {m.accion.label} <Icon name="arrow" />
                  </button>
                )}
                {m.chips && (
                  <div className="asistente__chips">
                    {m.chips.map((t) => (
                      <button key={t.id} className="asistente__chip" onClick={() => elegirChip(t)}>
                        {t.titulo}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={finRef} />
          </div>

          <form className="asistente__form" onSubmit={enviar}>
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escribe tu pregunta…"
              maxLength={200}
            />
            <button type="submit" disabled={!texto.trim()}>
              Enviar
            </button>
          </form>
        </div>
      )}

      <button
        className="asistente__boton"
        onClick={() => setAbierto((a) => !a)}
        aria-label={abierto ? 'Cerrar asistente' : 'Abrir asistente'}
      >
        {abierto ? '✕' : '💬'}
      </button>
    </div>
  );
}