import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';
import { TEMAS, temasVisibles, buscarTema } from '../lib/asistente';
import './InicioAssistant.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export default function InicioAssistant({ onNavigate }) {
  const { session, rol, can } = useAuth();
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [cursos, setCursos] = useState([]);
  const finRef = useRef(null);

  const visibles = useMemo(() => temasVisibles(TEMAS, { session, rol, can }), [session, rol, can]);

  useEffect(() => {
    fetch(`${API}/api/asistente/contexto`)
      .then((r) => r.json())
      .then((d) => setCursos(d.cursos || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMensajes([]);
  }, [session]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

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
        { rol: 'bot', texto: 'No encontré algo exacto para eso. Elige uno de estos temas:', chips: visibles },
      ]);
    }
  };

  const elegirChip = (tema) => {
    setMensajes((m) => [...m, { rol: 'user', texto: tema.titulo }]);
    responderConTema(tema);
  };

  return (
    <div className="inicio-asistente">
      <div className="inicio-asistente__header">
        <span className="inicio-asistente__icono">💬</span>
        <div>
          <h3>Asistente IINICIA</h3>
          <p>¿Nuevo por aquí? Pregúntame sobre cursos, registro o inicio de sesión.</p>
        </div>
      </div>

      <div className="inicio-asistente__cuerpo">
        <div className="inicio-asistente__burbuja inicio-asistente__burbuja--bot">
          <p>Elige un tema o escribe tu pregunta:</p>
          <div className="inicio-asistente__chips">
            {visibles.map((t) => (
              <button key={t.id} className="inicio-asistente__chip" onClick={() => elegirChip(t)}>
                {t.titulo}
              </button>
            ))}
          </div>
        </div>

        {mensajes.map((m, i) => (
          <div key={i} className={`inicio-asistente__burbuja inicio-asistente__burbuja--${m.rol}`}>
            <p>{m.texto}</p>
            {m.accion && (
              <button className="inicio-asistente__accion" onClick={() => onNavigate(m.accion.tab)}>
                {m.accion.label} <Icon name="arrow" />
              </button>
            )}
            {m.chips && (
              <div className="inicio-asistente__chips">
                {m.chips.map((t) => (
                  <button key={t.id} className="inicio-asistente__chip" onClick={() => elegirChip(t)}>
                    {t.titulo}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={finRef} />
      </div>

      <form className="inicio-asistente__form" onSubmit={enviar}>
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
  );
}