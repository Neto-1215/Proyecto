import { createClient } from '@supabase/supabase-js';

// Usamos una URL temporal válida de marcador de posición para evitar que la aplicación colapse
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://tfosjrumkshqpibqmxwu.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmb3NqcnVta3NocXBpYnFteHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzg1MTksImV4cCI6MjEwNzcxNDUxOX0.RNZSzdX70uaXN57c1osyMdMuX7GUG6bOTjsMVrWxpOM';

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