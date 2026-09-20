import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const SupabaseTestPage = () => {
  const [connectionStatus, setConnectionStatus] = useState<'loading' | 'success' | 'warning' | 'error'>('loading');
  const [tables, setTables] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string>('Checking...');

  useEffect(() => {
    const testConnection = async () => {
      try {
        // Lista de tablas comunes que podrían existir
        const commonTables = [
          'users',
          'profiles',
          'trips',
          'viajes',
          'solicitudes',
          'requests',
          'ratings',
          'calificaciones',
          'messages',
          'mensajes'
        ];

        const foundTables: string[] = [];
        let connectionWorking = false;

        // Intentar consultar cada tabla común
        for (const tableName of commonTables) {
          try {
            const { error: tableError } = await supabase
              .from(tableName)
              .select('*')
              .limit(1);

            if (!tableError) {
              foundTables.push(tableName);
              connectionWorking = true;
            }
          } catch {
            // Tabla no encontrada, continuar con la siguiente
          }
        }

        // Verificar autenticación
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError) {
          setAuthStatus('No autenticado (normal para pruebas)');
        } else {
          setAuthStatus(user?.email || 'No user');
        }

        if (connectionWorking) {
          setTables(foundTables);
          setConnectionStatus('success');
        } else {
          setConnectionStatus('warning');
          setError('Conexión funcionando pero no se encontraron tablas comunes. El proyecto de Supabase podría estar vacío o necesitar configuración de tablas.');
        }

      } catch (err) {
        console.error('Connection error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setConnectionStatus('error');
      }
    };

    testConnection();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Supabase Connection Test</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Connection Status</h2>
          
          {connectionStatus === 'loading' && (
            <div className="flex items-center text-blue-600">
              <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Testing connection...
            </div>
          )}
          
          {connectionStatus === 'success' && (
            <div className="flex items-center text-green-600">
              <svg className="h-5 w-5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Connected successfully! Tables found.
            </div>
          )}
          
          {connectionStatus === 'warning' && (
            <div className="flex items-center text-yellow-600">
              <svg className="h-5 w-5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Connection working but no tables found
            </div>
          )}
          
          {connectionStatus === 'error' && (
            <div className="flex items-center text-red-600">
              <svg className="h-5 w-5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              Connection failed: {error}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Authentication Status</h2>
          <p className="text-gray-700">{authStatus}</p>
        </div>

        {connectionStatus === 'success' && tables.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Available Tables</h2>
            <ul className="space-y-2">
              {tables.map((table) => (
                <li key={table} className="flex items-center text-gray-700">
                  <svg className="h-5 w-5 text-indigo-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                  {table}
                </li>
              ))}
            </ul>
          </div>
        )}

        {connectionStatus === 'warning' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold text-yellow-800 mb-4">No Tables Found</h2>
            <p className="text-yellow-700 mb-4">
              La conexión con Supabase funciona correctamente, pero no se encontraron tablas en el proyecto.
            </p>
            <p className="text-yellow-700 mb-4">
              Esto podría significar que:
            </p>
            <ul className="list-disc list-inside text-yellow-700 space-y-2">
              <li>El proyecto de Supabase está vacío y necesita configuración</li>
              <li>Las tablas tienen nombres diferentes a los esperados</li>
              <li>No hay permisos de lectura configurados en las tablas</li>
            </ul>
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={() => window.location.href = '/'}
            className="bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-lg"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
};

export default SupabaseTestPage;
