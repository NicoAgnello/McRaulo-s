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
  const { nombre, descripcion, precio_base, id_categoria, disponible = true } = req.body
  try {
    const [nuevoProducto] = await sql`
      INSERT INTO productos (nombre, descripcion, precio_base, categoria, disponible)
      VALUES (${nombre}, ${descripcion}, ${precio_base}, ${id_categoria}, ${disponible})
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
  const { nombre, descripcion, precio_base, id_categoria, disponible } = req.body
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
          id_categoria = ${id_categoria},
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
  const { id_categoria } = req.params
  try {
    const productos = await sql`
      SELECT * FROM productos
      WHERE id_categoria = ${id_categoria} AND disponible = TRUE
      ORDER BY nombre;
    `
    res.json({ status: 'OK', data: productos })
  } catch (error) {
    console.error(`Error al obtener productos de categoría ${id_categoria}:`, error)
    res.status(500).json({
      status: 'ERROR',
      message: `Error al obtener productos de categoría ${id_categoria}`,
      error: error.message
    })
  }
}


//Calcular precio
export const calcularPrecioPersonalizado = async (req, res) => {
  const { id } = req.params;
  const { ingredientes_personalizados } = req.body;

  try {
    const productoResult = await sql`
      SELECT * FROM productos
      WHERE id_producto = ${id} AND disponible = TRUE;
    `;
    if (productoResult.length === 0) {
      return res
        .status(404)
        .json({ status: 'ERROR', message: `Producto con ID ${id} no encontrado` });
    }

    const producto = productoResult[0];
    // Convertir precio_base a número
    const basePrice = parseFloat(producto.precio_base);
    let precioTotal = basePrice;
    const detallePrecios = [
      {
        concepto: 'Precio base',
        precio: basePrice
      }
    ];

    if (Array.isArray(ingredientes_personalizados)) {
      for (const ingrediente of ingredientes_personalizados) {
        // Solo procesar extras con cantidad positiva
        if (ingrediente.es_extra && ingrediente.cantidad > 0) {
          const ingredienteInfo = await sql`
            SELECT * FROM ingredientes
            WHERE id_ingrediente = ${ingrediente.id_ingrediente};
          `;
          if (ingredienteInfo.length > 0) {
            const precioIngrediente = parseFloat(ingredienteInfo[0].precio);
            const costoExtra = precioIngrediente * ingrediente.cantidad;
            precioTotal += costoExtra;
            detallePrecios.push({
              concepto: `Extra ${ingredienteInfo[0].nombre} (${ingrediente.cantidad} ${ingredienteInfo[0].unidad_medida})`,
              precio: costoExtra
            });
          }
        }
      }
    }

    res.json({
      status: 'OK',
      data: {
        producto: producto.nombre,
        precio_total: precioTotal,
        detalle_precios: detallePrecios
      }
    });
  } catch (error) {
    console.error('Error al calcular precio personalizado:', error);
    res
      .status(500)
      .json({ status: 'ERROR', message: 'Error al calcular precio del producto', error: error.message });
  }
};

