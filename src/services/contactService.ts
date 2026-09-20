import { supabase } from '../lib/supabase';

export interface ContactMessageParams {
  name: string;
  email: string;
  subject: string;
  message: string;
}

/**
 * Inserta un mensaje del formulario de contacto en la tabla contact_messages.
 * La política RLS "Everyone can create contact messages" permite el envío
 * sin autenticación; la validación de campos se hace antes (ver ContactPage).
 */
export const submitContactMessage = async (
  params: ContactMessageParams
): Promise<void> => {
  const { error } = await supabase.from('contact_messages').insert({
    name: params.name.trim(),
    email: params.email.trim(),
    subject: params.subject.trim(),
    message: params.message.trim(),
  });

  if (error) {
    console.error('Error submitting contact message:', error);
    throw new Error('No se pudo enviar el mensaje. Intenta nuevamente.');
  }
};