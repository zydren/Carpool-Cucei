import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Variables expuestas al bundle del cliente vía import.meta.env (ambos
  // prefijos; no se añade ninguno más):
  // - VITE_: el nativo de Vite (p. ej. VITE_SUPABASE_*).
  // - ROUTING_: la bandera de proveedor de rutas viaja en Vercel como
  //   ROUTING_PROVIDER (Vercel rechaza crear variables con prefijo VITE_) y
  //   aquí se expone con su prefijo real. El valor NO es un secreto: solo
  //   indica si el cliente debe intentar el proxy TomTom. TOMTOM_API_KEY no
  //   empieza por ninguno de estos prefijos y por tanto NUNCA se inlinea.
  envPrefix: ['VITE_', 'ROUTING_'],
})
