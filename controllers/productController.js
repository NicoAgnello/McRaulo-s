import sql from '../services/dbSupabase.js'

// Obtener todos los productos
export const getProducts = async (req, res) => {
  try {
    const productos = await sql`SELECT * FROM productos`
    res.json({
      status: 'OK',
      data: [productos]
    })
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
    res.json({
       status: 'OK',
       data: [producto]
    })
  } catch (error) {
    console.error('Error al obtener producto por ID:', error.message)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Obtener los ingredientes base (receta) de un producto
export const getRecetaDeProducto = async (req, res) => {
  const { id } = req.params;

  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'id de producto inválido (debe ser un entero positivo)'
    });
  }

  try {
    // Validar que el producto exista
    const prod = await sql`SELECT 1 FROM productos WHERE id_producto = ${idNum} LIMIT 1;`;
    if (prod.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: `Producto ${idNum} no existe` });
    }

    // Traer receta base
    const receta = await sql`
      SELECT 
        pib.id_producto,
        pib.id_ingrediente,
        i.nombre,
        i.descripcion,
        i.unidad_medida
      FROM productos_ingredientes_base pib
      JOIN ingredientes i ON i.id_ingrediente = pib.id_ingrediente
      WHERE pib.id_producto = ${idNum}
      ORDER BY i.nombre;
    `;

    // Si el producto existe pero no tiene receta cargada, devolvemos []
    return res.json({ status: 'OK', data: receta });
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      message: `Error al obtener ingredientes base del producto ${idNum}`,
      error: error.message
    });
  }
};


// Crear un nuevo producto
export const createProduct = async (req, res) => {
  const { nombre, descripcion, precio_base, id_categoria, disponible = true } = req.body
  try {
    const [nuevoProducto] = await sql`
      INSERT INTO productos (nombre, descripcion, precio_base, id_categoria, disponible)
      VALUES (${nombre}, ${descripcion}, ${precio_base}, ${id_categoria}, ${disponible})
      RETURNING *
    `
    res.json({
       status: 'OK - Creado',
       data: [nuevoProducto]
    })
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
    res.json({
       status: 'OK - Actualizado',
       data: [productoActualizado]
    })
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
    res.json({
       status: 'OK - Producto Eliminado Correctamente',
       data: [producto]
    })
  } catch (error) {
    console.error('Error al eliminar producto:', error.message)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Obtener productos por id_categoria (incluye nombre de la categoría)
export const getProductosPorCategoria = async (req, res) => {
  const { id_categoria } = req.params;

  // Validación básica del parámetro
  const id = Number(id_categoria);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'id_categoria inválido (debe ser un entero positivo)'
    });
  }

  try {
    const rows = await sql`
      SELECT 
        p.*,
        c.nombre AS categoria
      FROM productos p
      JOIN categoria c ON c.id_categoria = p.id_categoria
      WHERE p.id_categoria = ${id} AND p.disponible = TRUE
      ORDER BY p.id_producto;
    `;

    return res.json({ status: 'OK', data: rows });
  } catch (error) {
    console.error('Error al obtener productos por categoría:', error);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Error al obtener productos por categoría',
      error: error.message
    });
  }
};



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

