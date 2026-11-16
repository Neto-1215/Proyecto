import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan REACT_APP_SUPABASE_URL o REACT_APP_SUPABASE_ANON_KEY en el archivo .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
// Cliente temporal: sirve solo para validar la contraseña sin iniciar sesión en el portal
export const clienteTemporal = () =>
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'iinicia-verificacion',
    },
  });