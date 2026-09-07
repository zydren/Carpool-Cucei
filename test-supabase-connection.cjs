// Script para probar la conexión con Supabase desde Node.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('Probando conexión con Supabase...');
console.log('URL:', supabaseUrl);
console.log('Key:', supabaseKey ? 'Configurada' : 'No configurada');

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: Variables de entorno no configuradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    console.log('\nIntentando conectar con Supabase...');
    
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

    console.log('\nIntentando consultar tablas comunes...');
    let foundTables = [];

    for (const tableName of commonTables) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .limit(1);

        if (!error) {
          console.log(`✅ Tabla encontrada: ${tableName}`);
          foundTables.push(tableName);
        } else {
          console.log(`❌ Tabla no encontrada: ${tableName} (${error.code})`);
        }
      } catch (err) {
        console.log(`❌ Error al consultar ${tableName}: ${err.message}`);
      }
    }

    if (foundTables.length > 0) {
      console.log('\n✅ Conexión exitosa!');
      console.log('Tablas encontradas:', foundTables.length);
      console.log('Tablas:', foundTables.join(', '));
    } else {
      console.log('\n⚠️  Conexión funcionando pero no se encontraron tablas comunes.');
      console.log('Esto podría significar que:');
      console.log('  1. El proyecto de Supabase está vacío');
      console.log('  2. Las tablas tienen nombres diferentes');
      console.log('  3. No hay permisos de lectura en las tablas');
    }

    // Intentar obtener información del usuario actual (autenticación)
    console.log('\nVerificando autenticación...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.log('Estado de autenticación: No autenticado (normal para pruebas)');
    } else {
      console.log('Usuario autenticado:', user?.email || 'No user');
    }

  } catch (error) {
    console.error('Error de conexión:', error.message);
  }
}

testConnection().then(() => {
  console.log('\nPrueba finalizada.');
  process.exit(0);
}).catch((error) => {
  console.error('Error fatal:', error);
  process.exit(1);
});
