import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'; // o require('dotenv').config();

const supabaseUrl = 'https://vvgfzkdjsyxfswehnkxb.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;

// async function obtenerProductos() {
//   const { data, error } = await supabase
//     .from('productos')
//     .select('*');

//   if (error) {
//     console.error('Error al obtener productos:', error);
//     return;
//   }
//   console.log('Productos:', data);
// }

// obtenerProductos();

// async function testConexion() {
//   try {
//     // Probamos una consulta simple para verificar conexión
//     const { data, error } = await supabase.from('productos').select('id_producto').limit(1);

//     if (error) {
//       console.error('Error conectando a Supabase:', error.message);
//       return;
//     }
//     console.log('Conexión exitosa a Supabase!');
//   } catch (err) {
//     console.error('Error inesperado:', err);
//   }
// }

// testConexion();