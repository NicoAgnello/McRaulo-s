import postgres from 'postgres'

// Opciones de configuración para la conexión
const options = {
  // Número máximo de conexiones
  max: 10,
  // Tiempo de espera para la adquisición de conexiones (en segundos)
  idle_timeout: 30,
  // Tiempo de espera para la conexión (en segundos)
  connect_timeout: 30,
  // Configuraciones SSL para conexiones seguras
  // ssl: true, // Render.com requiere SSL
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

// Verificar que la variable de entorno esté cargada
console.log('DATABASE_URL cargada:', process.env.DATABASE_URL ? 'Sí' : 'No')

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL no está definida en el archivo .env')
  console.error('Asegúrate de tener un archivo .env en la raíz del proyecto con DATABASE_URL=tu_conexion_supabase')
  process.exit(1)
}

// Configuración de conexión a Supabase
const connectionString = process.env.DATABASE_URL

console.log('Conectando a:', connectionString.replace(/:[^:@]*@/, ':****@')) // Ocultar password en logs

const sql = postgres(connectionString, options)


export default sql