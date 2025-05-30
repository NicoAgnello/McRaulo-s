// controllers/categoriasController.js
import sql from '../services/dbSupabase.js'

export const getCategorias = async (req, res) => {
  try {
    const categorias = await sql`
      SELECT DISTINCT categoria FROM productos WHERE disponible = TRUE ORDER BY categoria;
    `
    res.json({ status: 'OK', data: categorias.map(c => c.categoria) })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Error al obtener categorías', error: error.message })
  }
}
