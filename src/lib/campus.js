import { api } from './api';

// Abre el curso en Moodle. Si es la primera vez del usuario, le muestra su contraseña inicial.
export async function abrirCampus(matriculaId) {
  const ventana = window.open('', '_blank');
  if (ventana) ventana.opener = null;
  try {
    const { url, usuario_moodle, password_inicial } = await api('/api/moodle/launch', {
      method: 'POST',
      body: { matricula_id: matriculaId },
    });

    if (password_inicial) {
      window.alert(
        `Es tu primera vez entrando al campus de Moodle.\n\nUsuario: ${usuario_moodle}\nContraseña: ${password_inicial}\n\nGuárdala. Podrás cambiarla después dentro de Moodle.`
      );
    }

    const destino = new URL(url);
    if (!['http:', 'https:'].includes(destino.protocol)) throw new Error('URL de acceso no válida.');
    if (ventana) ventana.location.href = destino.href;
    else window.location.href = destino.href;
  } catch (e) {
    if (ventana) ventana.close();
    throw e;
  }
}