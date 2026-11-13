import { api } from './api';

// Abre el curso en Moodle con la sesión ya iniciada (SSO).
export async function abrirCampus(matriculaId) {
  const ventana = window.open('', '_blank');
  try {
    const { url } = await api('/api/moodle/launch', {
      method: 'POST',
      body: { matricula_id: matriculaId },
    });
    if (ventana) ventana.location.href = url;
    else window.location.href = url;
  } catch (e) {
    if (ventana) ventana.close();
    throw e;
  }
}