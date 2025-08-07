export const getCategorias = async (req, res) => {
  try {
    const categorias = await sql`
      SELECT * FROM categoria ORDER BY nombre;
    `
    res.json({ status: 'OK', data: categorias })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Error al obtener categorías', error: error.message })
  }
}
