import postgres from 'postgres'

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

const sql = postgres(connectionString)


export default sql