import sql from '../services/dbSupabase.js'

// Obtener todos los productos
export const getProducts = async (req, res) => {
  try {
    const productos = await sql`SELECT * FROM productos`
    res.status(200).json(productos)
  } catch (error) {
    console.error('Error al obtener productos:', error.message)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Obtener un producto por ID
export const getProductById = async (req, res) => {
  const { id } = req.params
  try {
    const [producto] = await sql`SELECT * FROM productos WHERE id_producto = ${id}`
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }
    res.status(200).json(producto)
  } catch (error) {
    console.error('Error al obtener producto por ID:', error.message)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Crear un nuevo producto
export const createProduct = async (req, res) => {
  const { nombre, descripcion, precio_base, categoria, disponible = true } = req.body
  try {
    const [nuevoProducto] = await sql`
      INSERT INTO productos (nombre, descripcion, precio_base, categoria, disponible)
      VALUES (${nombre}, ${descripcion}, ${precio_base}, ${categoria}, ${disponible})
      RETURNING *
    `
    res.status(201).json(nuevoProducto)
  } catch (error) {
    console.error('Error al crear producto:', error.message)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Actualizar un producto
export const updateProduct = async (req, res) => {
  const { id } = req.params
  const { nombre, descripcion, precio_base, categoria, disponible } = req.body
  try {
    const [productoExistente] = await sql`SELECT * FROM productos WHERE id_producto = ${id}`
    if (!productoExistente) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const [productoActualizado] = await sql`
      UPDATE productos
      SET nombre = ${nombre},
          descripcion = ${descripcion},
          precio_base = ${precio_base},
          categoria = ${categoria},
          disponible = ${disponible}
      WHERE id_producto = ${id}
      RETURNING *
    `
    res.status(200).json(productoActualizado)
  } catch (error) {
    console.error('Error al actualizar producto:', error.message)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Eliminar un producto
export const deleteProduct = async (req, res) => {
  const { id } = req.params
  try {
    const [producto] = await sql`SELECT * FROM productos WHERE id_producto = ${id}`
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    await sql`DELETE FROM productos WHERE id_producto = ${id}`
    res.status(200).json({ mensaje: 'Producto eliminado correctamente' })
  } catch (error) {
    console.error('Error al eliminar producto:', error.message)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}
//Obtener productos por categoria
export const getProductosPorCategoria = async (req, res) => {
  const { categoria } = req.params

  try {
    const productos = await sql`
      SELECT * FROM productos
      WHERE categoria = ${categoria} AND disponible = TRUE
      ORDER BY nombre;
    `
    res.json({ status: 'OK', data: productos })
  } catch (error) {
    console.error(`Error al obtener productos de categoría ${categoria}:`, error)
    res.status(500).json({
      status: 'ERROR',
      message: `Error al obtener productos de categoría ${categoria}`,
      error: error.message
    })
  }
}


//Calcular precio
export const calcularPrecioPersonalizado = async (req, res) => {
  const { id } = req.params
  const { ingredientes_personalizados } = req.body

  try {
    const producto = await sql`
      SELECT * FROM productos WHERE id_producto = ${id} AND disponible = TRUE;
    `
    if (producto.length === 0)
      return res.status(404).json({ status: 'ERROR', message: `Producto con ID ${id} no encontrado` })

    let precioTotal = producto[0].precio_base
    const detallePrecios = [{
      concepto: 'Precio base',
      precio: producto[0].precio_base
    }]

    if (ingredientes_personalizados) {
      for (const ingrediente of ingredientes_personalizados) {
        if (ingrediente.es_extra) {
          const ingredienteInfo = await sql`
            SELECT * FROM ingredientes WHERE id_ingrediente = ${ingrediente.id_ingrediente};
          `
          if (ingredienteInfo.length > 0) {
            const costoExtra = ingredienteInfo[0].precio * ingrediente.cantidad
            precioTotal += costoExtra
            detallePrecios.push({
              concepto: `Extra ${ingredienteInfo[0].nombre} (${ingrediente.cantidad} ${ingredienteInfo[0].unidad_medida})`,
              precio: costoExtra
            })
          }
        }
      }
    }

    res.json({
      status: 'OK',
      data: {
        producto: producto[0].nombre,
        precio_total: precioTotal,
        detalle_precios: detallePrecios
      }
    })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al calcular precio del producto`, error: error.message })
  }
}
