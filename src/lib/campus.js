import { api } from './api';

// Pide el acceso al curso en Moodle. Devuelve { url, usuario_moodle, password_inicial }.
export async function obtenerAccesoCampus(matriculaId) {
  const { url, usuario_moodle, password_inicial } = await api('/api/moodle/launch', {
    method: 'POST',
    body: { matricula_id: matriculaId },
  });
  const destino = new URL(url);
  if (!['http:', 'https:'].includes(destino.protocol)) throw new Error('URL de acceso no válida.');
  return { url: destino.href, usuario_moodle, password_inicial };
}

// Abre el curso de Moodle en una pestaña nueva.
export function irACampus(url) {
  const ventana = window.open(url, '_blank');
  if (ventana) ventana.opener = null;
}