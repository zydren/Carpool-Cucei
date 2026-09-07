import { supabase } from '../lib/supabase';

export interface RegisterParams {
  email: string;
  password: string;
  fullName: string;
  phone: string;
}

export interface LoginParams {
  email: string;
  password: string;
}

/**
 * Registra un nuevo usuario en Supabase Auth
 * El trigger handle_new_user() creará automáticamente el profile
 */
export const register = async (params: RegisterParams) => {
  const { email, password, fullName, phone } = params;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        university: 'CUCEI',
        phone,
      },
    },
  });

  if (error) {
    console.error('Error registering user:', error);
    throw error;
  }

  return data;
};

/**
 * Inicia sesión de usuario
 */
export const login = async (params: LoginParams) => {
  const { email, password } = params;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error('Error logging in:', error);
    throw error;
  }

  return data;
};

/**
 * Cierra la sesión del usuario
 */
export const logout = async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('Error logging out:', error);
    throw error;
  }
};

/**
 * Obtiene el usuario actual autenticado
 */
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error) {
    console.error('Error getting current user:', error);
    throw error;
  }

  return user;
};

/**
 * Obtiene la sesión actual
 */
export const getSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error) {
    console.error('Error getting session:', error);
    throw error;
  }

  return session;
};

/**
 * Restablece la contraseña del usuario
 */
export const resetPassword = async (email: string) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) {
    console.error('Error resetting password:', error);
    throw error;
  }
};

/**
 * Actualiza la contraseña del usuario
 */
export const updatePassword = async (newPassword: string) => {
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    console.error('Error updating password:', error);
    throw error;
  }
};
