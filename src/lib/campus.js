import { api } from './api';

// Abre el curso en Moodle con la sesión ya iniciada (SSO).
export async function abrirCampus(matriculaId) {
  const ventana = window.open('', '_blank');
  if (ventana) ventana.opener = null; // la pestaña de Moodle no puede controlar este portal
  try {
    const { url } = await api('/api/moodle/launch', {
      method: 'POST',
      body: { matricula_id: matriculaId },
    });
    const destino = new URL(url);
    if (!['http:', 'https:'].includes(destino.protocol)) throw new Error('URL de acceso no válida.');
    if (ventana) ventana.location.href = destino.href;
    else window.location.href = destino.href;
  } catch (e) {
    if (ventana) ventana.close();
    throw e;
  }
}