import sql from '../services/dbSupabase.js'

// Obtener todos los productos
export const getProducts = async (req, res) => {
  try {
    console.log('Intentando obtener productos de la tabla productos...')
    const productos = await sql`SELECT * FROM productos`
    console.log('Productos obtenidos:', productos.length)
    res.json(productos)
  } catch (error) {
    console.error('Error completo:', error)
    console.error('Mensaje de error:', error.message)
    res.status(500).json({ 
      error: 'Error interno del servidor',
      details: error.message // Solo para debugging
    })
  }
}

// Obtener un producto por ID
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params
    const productos = await sql`SELECT * FROM productos WHERE id_producto = ${id}`
    
    if (productos.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }
    
    res.json(productos[0])
  } catch (error) {
    console.error('Error al obtener producto:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}
