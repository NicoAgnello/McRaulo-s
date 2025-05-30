// controllers/ingredientesController.js
import sql from '../services/dbSupabase.js'

export const getAllIngredientes = async (req, res) => {
  try {
    const ingredientes = await sql`
      SELECT * FROM ingredientes WHERE stock > 0 ORDER BY nombre;
    `
    res.json({ status: 'OK', data: ingredientes })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Error al obtener ingredientes', error: error.message })
  }
}

export const getIngredienteById = async (req, res) => {
  const { id } = req.params
  try {
    const ingrediente = await sql`
      SELECT * FROM ingredientes WHERE id_ingrediente = ${id};
    `
    if (ingrediente.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: `No se encontró el ingrediente con ID ${id}` })
    }
    res.json({ status: 'OK', data: ingrediente[0] })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al obtener ingrediente ${id}`, error: error.message })
  }
}
