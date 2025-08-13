// controllers/pedidosController.js
import sql from '../services/dbSupabase.js'

// 1. Obtener todos los pedidos
export const getAllPedidos = async (req, res) => {
  try {
    const pedidos = await sql`
      SELECT p.*, c.nombre AS nombre_cliente
      FROM pedidos p
      LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
      ORDER BY p.fecha_hora DESC;
    `
    res.json({ status: 'OK', data: pedidos })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Error al obtener pedidos', error: error.message })
  }
}

// 2. Obtener un pedido con sus detalles
export const getPedidoById = async (req, res) => {
  const { id } = req.params;
  try {
    // Traemos el pedido y todos los datos del cliente
    const pedidoResult = await sql`
      SELECT p.*, 
             c.id_cliente, c.nombre, c.email -- podés agregar más campos
      FROM pedidos p
      JOIN clientes c ON p.id_cliente = c.id_cliente
      WHERE p.id_pedido = ${id};
    `;

    if (pedidoResult.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: `No se encontró el pedido con ID ${id}` });
    }

    const pedido = pedidoResult[0];

    // Productos del pedido
    const productos = await sql`
      SELECT pp.*, p.nombre, p.descripcion, p.id_categoria
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      WHERE pp.id_pedido = ${id};
    `;

    // Ingredientes personalizados de cada producto
    const productosConIngredientes = await Promise.all(
      productos.map(async (producto) => {
        const ingredientes = await sql`
          SELECT ppi.*, i.nombre, i.descripcion, i.unidad_medida
          FROM pedidos_productos_ingredientes ppi
          JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
          WHERE ppi.id_pedido_producto = ${producto.id_pedido_producto};
        `;
        return { ...producto, ingredientes_personalizados: ingredientes };
      })
    );

    // Armamos la respuesta con el cliente separado
    const cliente = {
      id_cliente: pedido.id_cliente,
      nombre: pedido.nombre,
      email: pedido.email,
      // agregá más campos si querés
    };

    // Removemos del pedido los datos duplicados del cliente para evitar redundancia
    const { id_cliente, nombre, email, ...pedidoSinCliente } = pedido;

    res.json({
      status: 'OK',
      data: {
        pedido: pedidoSinCliente,
        cliente,
        productos: productosConIngredientes,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: `Error al obtener detalle del pedido ${id}`,
      error: error.message,
    });
  }
};


// 3. Crear nuevo pedido (-)
export const createPedido = async (req, res) => {
  const { productos, metodo_pago, id_metodo_pago, id_cliente } = req.body;

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ status: 'ERROR', message: 'Debe incluir al menos un producto en el pedido' });
  }
  if (!id_cliente) {
    return res.status(400).json({ status: 'ERROR', message: 'Debe incluir el ID del cliente' });
  }
  if (!id_metodo_pago && !metodo_pago) {
    return res.status(400).json({ status: 'ERROR', message: 'Debe especificar el método de pago (id_metodo_pago o metodo_pago)' });
  }

  try {
    const cli = await sql`SELECT 1 FROM clientes WHERE id_cliente = ${id_cliente}`;
    if (cli.length === 0) {
      return res.status(400).json({ status: 'ERROR', message: `El cliente ${id_cliente} no existe` });
    }

    // Resolver método de pago por id o por nombre
    let metodoPagoRow = null;
    if (id_metodo_pago) {
      const r = await sql`SELECT id_metodo_pago, nombre FROM metodo_pago WHERE id_metodo_pago = ${id_metodo_pago}`;
      if (r.length === 0) return res.status(400).json({ status: 'ERROR', message: `id_metodo_pago ${id_metodo_pago} inválido` });
      metodoPagoRow = r[0];
    } else {
      const r = await sql`SELECT id_metodo_pago, nombre FROM metodo_pago WHERE LOWER(nombre) = LOWER(${metodo_pago})`;
      if (r.length === 0) return res.status(400).json({ status: 'ERROR', message: `metodo_pago "${metodo_pago}" inválido` });
      metodoPagoRow = r[0];
    }

    // (Opcional) id del estado "pendiente"
    let estadoPendienteId = null;
    try {
      const e = await sql`SELECT id_estado FROM estado WHERE LOWER(nombre) = 'pendiente' LIMIT 1`;
      if (e.length > 0) estadoPendienteId = e[0].id_estado;
    } catch {}

    return await sql.begin(async (sql) => {
      // Calcular totales
      let total = 0;
      for (const prod of productos) {
        const prodRow = await sql`
          SELECT * FROM productos WHERE id_producto = ${prod.id_producto} AND disponible = TRUE;
        `;
        if (prodRow.length === 0) throw new Error(`Producto ${prod.id_producto} inexistente o no disponible`);

        let subtotal = parseFloat(prodRow[0].precio_base);

        if (Array.isArray(prod.ingredientes_personalizados)) {
          for (const ing of prod.ingredientes_personalizados) {
            const ingRow = await sql`SELECT * FROM ingredientes WHERE id_ingrediente = ${ing.id_ingrediente};`;
            if (ingRow.length === 0) throw new Error(`Ingrediente ${ing.id_ingrediente} inexistente`);
            if (ing.es_extra && ing.cantidad > 0) {
              subtotal += parseFloat(ingRow[0].precio) * ing.cantidad;
            }
          }
        }

        prod.subtotal = subtotal;
        total += subtotal;
      }

      // Insertar pedido (sin metodo_pago)
      let nuevoPedido;
      if (estadoPendienteId !== null) {
        [nuevoPedido] = await sql`
          INSERT INTO pedidos (fecha_hora, estado, total, id_cliente, estado_actual)
          VALUES (NOW(), 'pendiente', ${total}, ${id_cliente}, ${estadoPendienteId})
          RETURNING *;
        `;
      } else {
        [nuevoPedido] = await sql`
          INSERT INTO pedidos (fecha_hora, estado, total, id_cliente)
          VALUES (NOW(), 'pendiente', ${total}, ${id_cliente})
          RETURNING *;
        `;
      }

      // Líneas del pedido
      for (const prod of productos) {
        const [pp] = await sql`
          INSERT INTO pedidos_productos (id_pedido, id_producto, subtotal, notas)
          VALUES (${nuevoPedido.id_pedido}, ${prod.id_producto}, ${prod.subtotal}, ${prod.notas || null})
          RETURNING *;
        `;
        if (Array.isArray(prod.ingredientes_personalizados)) {
          for (const ing of prod.ingredientes_personalizados) {
            await sql`
              INSERT INTO pedidos_productos_ingredientes (id_pedido_producto, id_ingrediente, cantidad, es_extra)
              VALUES (${pp.id_pedido_producto}, ${ing.id_ingrediente}, ${ing.cantidad}, ${ing.es_extra});
            `;
          }
        }
      }

      // Registrar compra con el método de pago
      await sql`
        INSERT INTO compra (id_pedido, id_metodo_pago, fecha)
        VALUES (${nuevoPedido.id_pedido}, ${metodoPagoRow.id_metodo_pago}, NOW());
      `;

      // Datos del cliente para la respuesta
      const [clienteData] = await sql`
        SELECT id_cliente, nombre, email FROM clientes WHERE id_cliente = ${id_cliente};
      `;

      return res.status(201).json({
        status: 'OK',
        message: 'Pedido creado correctamente',
        data: { pedido: nuevoPedido, cliente: clienteData, productos }
      });
    });
  } catch (error) {
    console.error('Error al crear pedido:', error);
    return res.status(500).json({ status: 'ERROR', message: 'Error al crear el pedido', error: error.message });
  }
};


// 4. Actualizar estado de un pedido
export const updateEstadoPedido = async (req, res) => {
  const { id } = req.params
  const { estado } = req.body
  const estadosValidos = ['pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado']

  if (!estado || !estadosValidos.includes(estado)) {
    return res.status(400).json({
      status: 'ERROR',
      message: `Estado inválido. Debe ser uno de: ${estadosValidos.join(', ')}`
    })
  }

  try {
    const pedido = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`
    if (pedido.length === 0) return res.status(404).json({ status: 'ERROR', message: `No se encontró el pedido con ID ${id}` })

    await sql`
      UPDATE pedidos SET estado = ${estado} WHERE id_pedido = ${id};
    `

    // Traer pedido actualizado con datos del cliente
    const pedidoConCliente = await sql`
      SELECT p.*, c.nombre AS cliente_nombre, c.email AS cliente_email
      FROM pedidos p
      JOIN clientes c ON p.id_cliente = c.id_cliente
      WHERE p.id_pedido = ${id};
    `

    // Traer productos con ingredientes
    const productos = await sql`
      SELECT pp.*, p.nombre, p.descripcion, p.id_categoria
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      WHERE pp.id_pedido = ${id};
    `

    const productosConIngredientes = await Promise.all(
      productos.map(async (producto) => {
        const ingredientes = await sql`
          SELECT ppi.*, i.nombre, i.descripcion, i.unidad_medida
          FROM pedidos_productos_ingredientes ppi
          JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
          WHERE ppi.id_pedido_producto = ${producto.id_pedido_producto};
        `
        return { ...producto, ingredientes_personalizados: ingredientes }
      })
    )

    res.json({ 
      status: 'OK', 
      message: `Estado actualizado a "${estado}"`, 
      data: { ...pedidoConCliente[0], productos: productosConIngredientes }
    })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al actualizar estado del pedido ${id}`, error: error.message })
  }
}

// 5. Eliminar un pedido (-)
export const deletePedido = async (req, res) => {
  const { id } = req.params
  try {
    const pedido = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`
    if (pedido.length === 0) return res.status(404).json({ status: 'ERROR', message: `Pedido con ID ${id} no existe` })

    return await sql.begin(async (sql) => {
      const pedidosProductos = await sql`
        SELECT id_pedido_producto FROM pedidos_productos WHERE id_pedido = ${id};
      `

      for (const pp of pedidosProductos) {
        await sql`DELETE FROM pedidos_productos_ingredientes WHERE id_pedido_producto = ${pp.id_pedido_producto};`
      }

      await sql`DELETE FROM pedidos_productos WHERE id_pedido = ${id};`
      await sql`DELETE FROM pedidos WHERE id_pedido = ${id};`

      res.json({ status: 'OK', message: `Pedido ${id} eliminado correctamente` })
    })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al eliminar pedido ${id}`, error: error.message })
  }
}

// 6. Obtener pedidos por estado
export const getPedidosByEstado = async (req, res) => {
  const { estado } = req.params
  try {
    const pedidos = await sql`
      SELECT p.*, c.nombre AS cliente_nombre, c.email AS cliente_email
      FROM pedidos p
      JOIN clientes c ON p.id_cliente = c.id_cliente
      WHERE p.estado = ${estado}
      ORDER BY p.fecha_hora DESC;
    `

    res.json({ status: 'OK', data: pedidos })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al obtener pedidos con estado ${estado}`, error: error.message })
  }
}


// 7. Obtener detalle de un producto en un pedido
export const getProductoDetalleEnPedido = async (req, res) => {
  const { idPedido, idPedidoProducto } = req.params
  try {
      const producto = await sql`
        SELECT pp.*, 
              p.nombre, 
              p.descripcion, 
              c.nombre AS categoria
        FROM pedidos_productos pp
        JOIN productos p ON pp.id_producto = p.id_producto
        LEFT JOIN categoria c ON p.id_categoria = c.id_categoria
        WHERE pp.id_pedido = ${idPedido} AND pp.id_pedido_producto = ${idPedidoProducto};
    `

    if (producto.length === 0) return res.status(404).json({ status: 'ERROR', message: `Producto no encontrado en el pedido` })

    const ingredientes = await sql`
      SELECT ppi.*, i.nombre, i.descripcion, i.unidad_medida
      FROM pedidos_productos_ingredientes ppi
      JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
      WHERE ppi.id_pedido_producto = ${idPedidoProducto};
    `

    res.json({
      status: 'OK',
      data: {
        ...producto[0],
        ingredientes_extra: ingredientes.filter(i => i.es_extra),
        ingredientes_removidos: ingredientes.filter(i => !i.es_extra)
      }
    })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al obtener detalle del producto en el pedido`, error: error.message })
  }
}

// 8. Estadísticas de pedidos
export const getEstadisticasPedidos = async (req, res) => {
  try {
    const totalPedidos = await sql`
      SELECT COUNT(*) AS total
      FROM pedidos;
    `;

    const pedidosPorEstado = await sql`
      SELECT estado, COUNT(*) AS cantidad
      FROM pedidos
      GROUP BY estado;
    `;

    const productosMasVendidos = await sql`
      SELECT p.id_producto, p.nombre, c.nombre AS categoria,
             COUNT(pp.id_pedido_producto) AS unidades_vendidas,
             SUM(pp.subtotal)            AS ventas_totales
      FROM pedidos_productos pp
      JOIN productos p      ON pp.id_producto = p.id_producto
      LEFT JOIN categoria c ON p.id_categoria = c.id_categoria
      GROUP BY p.id_producto, p.nombre, c.nombre
      ORDER BY unidades_vendidas DESC
      LIMIT 5;
    `;

    const ingredientesMasSolicitados = await sql`
      SELECT i.id_ingrediente, i.nombre, i.unidad_medida,
             SUM(ppi.cantidad) AS veces_solicitado
      FROM pedidos_productos_ingredientes ppi
      JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
      WHERE ppi.es_extra = TRUE
      GROUP BY i.id_ingrediente, i.nombre, i.unidad_medida
      ORDER BY veces_solicitado DESC
      LIMIT 5;
    `;

    // 🔧 Ventas por método de pago (usando compra y metodo_pago)
    const ventasPorMetodoPago = await sql`
      SELECT 
        mp.id_metodo_pago,
        mp.nombre        AS metodo_pago,
        COUNT(*)         AS cantidad_pedidos,
        SUM(p.total)     AS total_ventas
      FROM pedidos p
      JOIN compra c          ON c.id_pedido       = p.id_pedido
      JOIN metodo_pago mp    ON mp.id_metodo_pago = c.id_metodo_pago
      GROUP BY mp.id_metodo_pago, mp.nombre
      ORDER BY total_ventas DESC;
    `;

    const productosConMasPersonalizaciones = await sql`
      SELECT p.id_producto, p.nombre, c.nombre AS categoria,
             COUNT(ppi.id_pedido_producto) AS total_personalizaciones
      FROM productos p
      JOIN categoria c ON p.id_categoria = c.id_categoria
      JOIN pedidos_productos pp ON p.id_producto = pp.id_producto
      JOIN pedidos_productos_ingredientes ppi ON pp.id_pedido_producto = ppi.id_pedido_producto
      GROUP BY p.id_producto, p.nombre, c.nombre
      ORDER BY total_personalizaciones DESC
      LIMIT 5;
    `;

    res.json({
      status: 'OK',
      data: {
        total_pedidos: totalPedidos[0].total,
        pedidos_por_estado: pedidosPorEstado,
        productos_mas_vendidos: productosMasVendidos,
        ingredientes_extras_mas_solicitados: ingredientesMasSolicitados,
        ventas_por_metodo_pago: ventasPorMetodoPago,
        productos_con_mas_personalizaciones: productosConMasPersonalizaciones
      }
    });
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Error al obtener estadísticas',
      error: error.message
    });
  }
};


export const agregarProductosAlPedido = async (req, res) => {
  const { id } = req.params;
  const { productos } = req.body;

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe incluir al menos un producto para agregar al pedido'
    });
  }

  try {
    const pedidoExistente = await sql`
      SELECT * FROM pedidos WHERE id_pedido = ${id};
    `;
    if (pedidoExistente.length === 0) {
      return res.status(404).json({
        status: 'ERROR',
        message: `No se encontró el pedido con ID ${id}`
      });
    }

    if (['entregado', 'cancelado'].includes(pedidoExistente[0].estado)) {
      return res.status(400).json({
        status: 'ERROR',
        message: `No se pueden agregar productos a un pedido en estado "${pedidoExistente[0].estado}"`
      });
    }

    return await sql.begin(async (sql) => {
      let totalAdicional = 0;
      const productosAgregados = [];

      for (const producto of productos) {
        const productoInfo = await sql`
          SELECT * FROM productos
          WHERE id_producto = ${producto.id_producto}
            AND disponible = TRUE;
        `;
        if (productoInfo.length === 0) {
          throw new Error(`El producto con ID ${producto.id_producto} no existe o no está disponible`);
        }

        // parseFloat directamente sobre precio_base
        let subtotal = parseFloat(productoInfo[0].precio_base);

        if (Array.isArray(producto.ingredientes_personalizados)) {
          for (const ing of producto.ingredientes_personalizados) {
            const ingredienteInfo = await sql`
              SELECT * FROM ingredientes
              WHERE id_ingrediente = ${ing.id_ingrediente};
            `;
            if (ingredienteInfo.length === 0) {
              throw new Error(`El ingrediente con ID ${ing.id_ingrediente} no existe`);
            }

            if (ing.es_extra && ing.cantidad > 0) {
              // parseFloat directamente sobre precio de ingrediente
              const precioIng = parseFloat(ingredienteInfo[0].precio);
              subtotal += precioIng * ing.cantidad;
            }
          }
        }

        totalAdicional += subtotal;

        const nuevoPedidoProducto = await sql`
          INSERT INTO pedidos_productos
            (id_pedido, id_producto, subtotal, notas)
          VALUES
            (${id}, ${producto.id_producto}, ${subtotal}, ${producto.notas || null})
          RETURNING *;
        `;
        productosAgregados.push(nuevoPedidoProducto[0]);

        if (Array.isArray(producto.ingredientes_personalizados)) {
          for (const ing of producto.ingredientes_personalizados) {
            await sql`
              INSERT INTO pedidos_productos_ingredientes
                (id_pedido_producto, id_ingrediente, cantidad, es_extra)
              VALUES
                (${nuevoPedidoProducto[0].id_pedido_producto},
                 ${ing.id_ingrediente},
                 ${ing.cantidad},
                 ${ing.es_extra});
            `;
          }
        }
      }

      // parseFloat sobre total anterior
      const totalActual = parseFloat(pedidoExistente[0].total);
      const nuevoTotal  = totalActual + totalAdicional;

      const pedidoActualizado = await sql`
        UPDATE pedidos
        SET total = ${nuevoTotal}
        WHERE id_pedido = ${id}
        RETURNING *;
      `;

      return res.json({
        status: 'OK',
        message: 'Productos agregados correctamente al pedido',
        data: {
          pedido: pedidoActualizado[0],
          productos_agregados: productosAgregados,
          total_adicional: totalAdicional
        }
      });
    });
  } catch (error) {
    console.error('Error al agregar productos al pedido:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Error al agregar productos al pedido',
      error: error.message
    });
  }
};




// 10. Filtrar pedidos por rango de fechas
export const filtrarPedidosPorFecha = async (req, res) => {
  const { desde, hasta } = req.query;

  if (!desde || !hasta) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe proporcionar fechas (desde, hasta) como Unix epoch en segundos o milisegundos'
    });
  }

  try {
    // Acepta epoch en segundos o milisegundos
    const toSecs = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error('Parámetros desde/hasta inválidos');
      return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n); // ms -> s
    };

    const d = toSecs(desde);
    const h = toSecs(hasta);

    const pedidos = await sql`
      SELECT *
      FROM pedidos
      WHERE fecha_hora >= to_timestamp(${d})::timestamp
        AND fecha_hora < to_timestamp(${h})::timestamp
      ORDER BY fecha_hora DESC;
    `;

    res.json({ status: 'OK', data: pedidos });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Error al filtrar pedidos por fecha',
      error: error.message
    });
  }
};

// 11. Obtener resumen de productos en un pedido
export const obtenerResumenPedido = async (req, res) => {
  const { id } = req.params
  try {
    const pedido = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`
    if (pedido.length === 0)
      return res.status(404).json({ status: 'ERROR', message: `No se encontró el pedido con ID ${id}` })

      const resumenProductos = await sql`
      SELECT p.id_producto, p.nombre, c.nombre AS categoria, p.precio_base,
             COUNT(pp.id_pedido_producto) as cantidad_total,
             SUM(pp.subtotal) as subtotal_total,
             AVG(pp.subtotal) as precio_promedio_personalizado
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      LEFT JOIN categoria c ON p.id_categoria = c.id_categoria
      WHERE pp.id_pedido = ${id}
      GROUP BY p.id_producto, p.nombre, c.nombre, p.precio_base
      ORDER BY cantidad_total DESC, p.nombre;
    `    

    const productosDetallados = await sql`
      SELECT pp.id_pedido_producto, pp.id_producto, p.nombre, 
             pp.subtotal, pp.notas,
             CASE 
               WHEN COUNT(ppi.id_ingrediente) > 0 THEN true 
               ELSE false 
             END as tiene_personalizaciones
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      LEFT JOIN pedidos_productos_ingredientes ppi ON pp.id_pedido_producto = ppi.id_pedido_producto
      WHERE pp.id_pedido = ${id}
      GROUP BY pp.id_pedido_producto, pp.id_producto, p.nombre, pp.subtotal, pp.notas
      ORDER BY p.nombre, pp.id_pedido_producto;
    `

    res.json({
      status: 'OK',
      data: {
        pedido: pedido[0],
        resumen_por_producto: resumenProductos,
        productos_detallados: productosDetallados
      }
    })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al obtener resumen del pedido ${id}`, error: error.message })
  }
}

// 12. Eliminar producto específico de un pedido
export const eliminarProductoDePedido = async (req, res) => {
  const { id, idProducto } = req.params

  try {
    const pedido = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`
    if (pedido.length === 0)
      return res.status(404).json({ status: 'ERROR', message: `Pedido con ID ${id} no encontrado` })

    const producto = await sql`
      SELECT * FROM pedidos_productos
      WHERE id_pedido = ${id} AND id_pedido_producto = ${idProducto};
    `
    if (producto.length === 0)
      return res.status(404).json({ status: 'ERROR', message: `Producto no encontrado en pedido` })

    if (['entregado', 'cancelado'].includes(pedido[0].estado)) {
      return res.status(400).json({
        status: 'ERROR',
        message: `No se puede modificar un pedido en estado "${pedido[0].estado}"`
      })
    }

    return await sql.begin(async (sql) => {
      const subtotalEliminado = producto[0].subtotal

      await sql`DELETE FROM pedidos_productos_ingredientes WHERE id_pedido_producto = ${idProducto};`
      await sql`DELETE FROM pedidos_productos WHERE id_pedido_producto = ${idProducto};`

      const nuevoTotal = pedido[0].total - subtotalEliminado
      const pedidoActualizado = await sql`
        UPDATE pedidos SET total = ${nuevoTotal} WHERE id_pedido = ${id} RETURNING *;
      `

      return res.json({
        status: 'OK',
        message: 'Producto eliminado del pedido',
        data: {
          pedido: pedidoActualizado[0],
          subtotal_eliminado: subtotalEliminado
        }
      })
    })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al eliminar producto del pedido`, error: error.message })
  }
}

// GET /api/pedidos/metodo-pago/:metodo
export const getPedidosPorMetodoPago = async (req, res) => {
  const { metodo } = req.params;

  try {
    // 1) Resolver método de pago (por ID numérico o por nombre)
    let mpRow;
    if (/^\d+$/.test(metodo)) {
      const r = await sql`
        SELECT id_metodo_pago, nombre
        FROM metodo_pago
        WHERE id_metodo_pago = ${Number(metodo)}
        LIMIT 1;
      `;
      if (r.length === 0) {
        return res.status(404).json({
          status: 'ERROR',
          message: `Método de pago con id ${metodo} no existe`
        });
      }
      mpRow = r[0];
    } else {
      const r = await sql`
        SELECT id_metodo_pago, nombre
        FROM metodo_pago
        WHERE LOWER(nombre) = LOWER(${metodo})
        LIMIT 1;
      `;
      if (r.length === 0) {
        return res.status(404).json({
          status: 'ERROR',
          message: `Método de pago "${metodo}" no existe`
        });
      }
      mpRow = r[0];
    }

    // 2) Traer pedidos asociados a ese método (via compra)
    const pedidos = await sql`
      SELECT p.*, mp.nombre AS metodo_pago
      FROM pedidos p
      JOIN compra c          ON c.id_pedido       = p.id_pedido
      JOIN metodo_pago mp    ON mp.id_metodo_pago = c.id_metodo_pago
      WHERE mp.id_metodo_pago = ${mpRow.id_metodo_pago}
      ORDER BY p.fecha_hora DESC;
    `;

    // 3) Respuesta (si no hay pedidos, devolvemos 200 con lista vacía)
    return res.json({
      status: 'OK',
      meta: {
        metodo_pago: { id: mpRow.id_metodo_pago, nombre: mpRow.nombre },
        cantidad: pedidos.length
      },
      data: pedidos
    });
  } catch (error) {
    console.error('Error al obtener pedidos por método de pago:', error);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Error al obtener pedidos por método de pago',
      error: error.message
    });
  }
};



export const getPedidosByCliente = async (req, res) => {
  const { idCliente } = req.params;
  try {
    const pedidos = await sql`
      SELECT * FROM pedidos
      WHERE id_cliente = ${idCliente}
      ORDER BY fecha_hora DESC;
    `
    res.json({ status: 'OK', data: pedidos })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Error al obtener pedidos del cliente', error: error.message })
  }
}
