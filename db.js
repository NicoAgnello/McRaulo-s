// db.js
import postgres from 'postgres';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Opciones de configuración para la conexión
const options = {
  // Número máximo de conexiones
  max: 10,
  // Tiempo de espera para la adquisición de conexiones (en segundos)
  idle_timeout: 30,
  // Tiempo de espera para la conexión (en segundos)
  connect_timeout: 30,
  // Configuraciones SSL para conexiones seguras
  ssl: true, // Render.com requiere SSL
  // Permite verificar si la conexión es válida antes de usarla
  onnotice: () => {},
  debug: process.env.NODE_ENV === 'development',
  // Reintentos de conexión
  max_lifetime: 60 * 30, // 30 minutos
  retry_limit: 3,
  connection: {
    application_name: 'autoservicio-burgers-api'
  }
};

// Validar que tenemos la cadena de conexión
if (!process.env.DATABASE_URL) {
  console.error('❌ La variable de entorno DATABASE_URL no está definida');
  process.exit(1);
}

console.log('🔌 Intentando conectar a la base de datos en Render.com...');
// Ocultar la contraseña en los logs
const safeUrl = process.env.DATABASE_URL.replace(/:[^:]*@/, ':****@');
console.log(`🔗 URL: ${safeUrl}`);

// Crear conexión a la base de datos
const sql = postgres(process.env.DATABASE_URL, options);

// Función para probar la conexión
export const testConnection = async () => {
  try {
    // Ejecutar una consulta simple para verificar la conexión
    const result = await sql`SELECT NOW() as time`;
    console.log('✅ Conexión exitosa a la base de datos');
    console.log(`📅 Fecha y hora del servidor: ${result[0].time}`);
    
    // Intentar obtener las tablas disponibles
    try {
      const tables = await sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `;
      
      if (tables.length === 0) {
        console.log('📋 No se encontraron tablas en el esquema público');
      } else {
        console.log('📋 Tablas disponibles:');
        tables.forEach((table, index) => {
          console.log(`   ${index + 1}. ${table.table_name}`);
        });
      }
    } catch (tableError) {
      console.error('❌ No se pudieron obtener las tablas:', tableError.message);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error al conectar con la base de datos:', error.message);
    if (error.code) {
      console.error(`📋 Código de error: ${error.code}`);
    }
    return false;
  }
};

// Exportar la instancia de la conexión
export default sql;
