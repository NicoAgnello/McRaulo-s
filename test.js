import 'dotenv/config';
import sql from './services/dbSupabase.js';

const test = async () => {
  try {
    const res = await sql`SELECT * FROM productos`;
    console.log('Conexión exitosa:', res);
  } catch (err) {
    console.error('Error al conectar a la DB:', err.message);
  }
};

test();