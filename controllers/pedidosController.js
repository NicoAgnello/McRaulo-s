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
      SELECT pp.*, p.nombre, p.descripcion, p.categoria
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


// 3. Crear nuevo pedido
// export const createPedido = async (req, res) => {
//   const { productos, metodo_pago, id_cliente } = req.body

//   if (!productos || !Array.isArray(productos) || productos.length === 0)
//     return res.status(400).json({ status: 'ERROR', message: 'Debe incluir al menos un producto en el pedido' })

//   if (!metodo_pago)
//     return res.status(400).json({ status: 'ERROR', message: 'Debe especificar el método de pago' })
//   if (!id_cliente)
//     return res.status(400).json({ status: 'ERROR', message: 'Debe incluir el ID del cliente' });
//   try {
//     return await sql.begin(async (sql) => {
//       let total = 0

//       for (const producto of productos) {
//         const productoInfo = await sql`
//           SELECT * FROM productos 
//           WHERE id_producto = ${producto.id_producto} 
//           AND disponible = TRUE;
//         `
//         if (productoInfo.length === 0) throw new Error(`Producto con ID ${producto.id_producto} no existe`)

//         let subtotal = productoInfo[0].precio_base

//         if (producto.ingredientes_personalizados) {
//           for (const ingrediente of producto.ingredientes_personalizados) {
//             if (ingrediente.es_extra) {
//               const ingredienteInfo = await sql`
//                 SELECT * FROM ingredientes
//                 WHERE id_ingrediente = ${ingrediente.id_ingrediente};
//               `
//               if (ingredienteInfo.length === 0) throw new Error(`Ingrediente con ID ${ingrediente.id_ingrediente} no existe`)
//               subtotal += ingredienteInfo[0].precio * ingrediente.cantidad
//             }
//           }
//         }

//         producto.subtotal = subtotal
//         total += subtotal
//       }

//       const fechaHora = Math.floor(Date.now() / 1000)

//       const nuevoPedido = await sql`
//         INSERT INTO pedidos (fecha_hora, estado, total, metodo_pago, id_cliente)
//         VALUES (${fechaHora}, 'pendiente', ${total}, ${metodo_pago}, ${id_cliente})
//         RETURNING *;
//       `


//       for (const producto of productos) {
//         const nuevoPedidoProducto = await sql`
//           INSERT INTO pedidos_productos (id_pedido, id_producto, subtotal, notas)
//           VALUES (${nuevoPedido[0].id_pedido}, ${producto.id_producto}, ${producto.subtotal}, ${producto.notas || null})
//           RETURNING *;
//         `

//         if (producto.ingredientes_personalizados) {
//           for (const ingrediente of producto.ingredientes_personalizados) {
//             await sql`
//               INSERT INTO pedidos_productos_ingredientes (
//                 id_pedido_producto, id_ingrediente, cantidad, es_extra
//               ) VALUES (
//                 ${nuevoPedidoProducto[0].id_pedido_producto},
//                 ${ingrediente.id_ingrediente},
//                 ${ingrediente.cantidad},
//                 ${ingrediente.es_extra}
//               );
//             `
//           }
//         }
//       }

//       return res.status(201).json({
//         status: 'OK',
//         message: 'Pedido creado correctamente',
//         data: nuevoPedido[0]
//       })
//     })
//   } catch (error) {
//     res.status(500).json({ status: 'ERROR', message: 'Error al crear el pedido', error: error.message })
//   }
// }
export const createPedido = async (req, res) => {
  const { productos, metodo_pago, id_cliente } = req.body

  if (!productos || !Array.isArray(productos) || productos.length === 0)
    return res.status(400).json({ status: 'ERROR', message: 'Debe incluir al menos un producto en el pedido' })

  if (!metodo_pago)
    return res.status(400).json({ status: 'ERROR', message: 'Debe especificar el método de pago' })

  if (!id_cliente)
    return res.status(400).json({ status: 'ERROR', message: 'Debe incluir el ID del cliente' });

  try {
    return await sql.begin(async (sql) => {
      let total = 0

      for (const producto of productos) {
        const productoInfo = await sql`
          SELECT * FROM productos 
          WHERE id_producto = ${producto.id_producto} 
          AND disponible = TRUE;
        `
        if (productoInfo.length === 0) throw new Error(`Producto con ID ${producto.id_producto} no existe`)

        let subtotal = productoInfo[0].precio_base

        if (producto.ingredientes_personalizados) {
          for (const ingrediente of producto.ingredientes_personalizados) {
            if (ingrediente.es_extra) {
              const ingredienteInfo = await sql`
                SELECT * FROM ingredientes
                WHERE id_ingrediente = ${ingrediente.id_ingrediente};
              `
              if (ingredienteInfo.length === 0) throw new Error(`Ingrediente con ID ${ingrediente.id_ingrediente} no existe`)
              subtotal += ingredienteInfo[0].precio * ingrediente.cantidad
            }
          }
        }

        producto.subtotal = subtotal
        total += subtotal
      }

      const fechaHora = Math.floor(Date.now() / 1000)

      const nuevoPedido = await sql`
        INSERT INTO pedidos (fecha_hora, estado, total, metodo_pago, id_cliente)
        VALUES (${fechaHora}, 'pendiente', ${total}, ${metodo_pago}, ${id_cliente})
        RETURNING *;
      `

      for (const producto of productos) {
        const nuevoPedidoProducto = await sql`
          INSERT INTO pedidos_productos (id_pedido, id_producto, subtotal, notas)
          VALUES (${nuevoPedido[0].id_pedido}, ${producto.id_producto}, ${producto.subtotal}, ${producto.notas || null})
          RETURNING *;
        `

        if (producto.ingredientes_personalizados) {
          for (const ingrediente of producto.ingredientes_personalizados) {
            await sql`
              INSERT INTO pedidos_productos_ingredientes (
                id_pedido_producto, id_ingrediente, cantidad, es_extra
              ) VALUES (
                ${nuevoPedidoProducto[0].id_pedido_producto},
                ${ingrediente.id_ingrediente},
                ${ingrediente.cantidad},
                ${ingrediente.es_extra}
              );
            `
          }
        }
      }

      // Buscar datos del cliente para devolver en la response
      const clienteData = await sql`
        SELECT id_cliente, nombre, email -- agregá más campos si querés
        FROM clientes
        WHERE id_cliente = ${id_cliente};
      `

      res.status(201).json({
        status: 'OK',
        message: 'Pedido creado correctamente',
        data: {
          pedido: nuevoPedido[0],
          cliente: clienteData[0],
          productos // o armá productos con los datos más completos si querés
        }
      })
    })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Error al crear el pedido', error: error.message })
  }
}


// 4. Actualizar estado de un pedido
// export const updateEstadoPedido = async (req, res) => {
//   const { id } = req.params
//   const { estado } = req.body
//   const estadosValidos = ['pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado']

//   if (!estado || !estadosValidos.includes(estado)) {
//     return res.status(400).json({
//       status: 'ERROR',
//       message: `Estado inválido. Debe ser uno de: ${estadosValidos.join(', ')}`
//     })
//   }

//   try {
//     const pedido = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`
//     if (pedido.length === 0) return res.status(404).json({ status: 'ERROR', message: `No se encontró el pedido con ID ${id}` })

//     const pedidoActualizado = await sql`
//       UPDATE pedidos SET estado = ${estado} WHERE id_pedido = ${id} RETURNING *;
//     `

//     res.json({ status: 'OK', message: `Estado actualizado a "${estado}"`, data: pedidoActualizado[0] })
//   } catch (error) {
//     res.status(500).json({ status: 'ERROR', message: `Error al actualizar estado del pedido ${id}`, error: error.message })
//   }
// }
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
      SELECT pp.*, p.nombre, p.descripcion, p.categoria
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

// 5. Eliminar un pedido
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
      SELECT pp.*, p.nombre, p.descripcion, p.categoria
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
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
    const totalPedidos = await sql`SELECT COUNT(*) as total FROM pedidos;`
    const pedidosPorEstado = await sql`SELECT estado, COUNT(*) as cantidad FROM pedidos GROUP BY estado;`
    const productosMasVendidos = await sql`
      SELECT p.id_producto, p.nombre, p.categoria,
             COUNT(pp.id_pedido_producto) as unidades_vendidas,
             SUM(pp.subtotal) as ventas_totales
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      GROUP BY p.id_producto, p.nombre, p.categoria
      ORDER BY unidades_vendidas DESC
      LIMIT 5;
    `
    const ingredientesMasSolicitados = await sql`
      SELECT i.id_ingrediente, i.nombre, i.unidad_medida,
             SUM(ppi.cantidad) as veces_solicitado
      FROM pedidos_productos_ingredientes ppi
      JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
      WHERE ppi.es_extra = TRUE
      GROUP BY i.id_ingrediente, i.nombre, i.unidad_medida
      ORDER BY veces_solicitado DESC
      LIMIT 5;
    `
    const ventasPorMetodoPago = await sql`
      SELECT metodo_pago, COUNT(*) as cantidad_pedidos, SUM(total) as total_ventas
      FROM pedidos
      GROUP BY metodo_pago;
    `
    const productosConMasPersonalizaciones = await sql`
      SELECT p.id_producto, p.nombre, p.categoria,
             COUNT(ppi.id_pedido_producto) as total_personalizaciones
      FROM productos p
      JOIN pedidos_productos pp ON p.id_producto = pp.id_producto
      JOIN pedidos_productos_ingredientes ppi ON pp.id_pedido_producto = ppi.id_pedido_producto
      GROUP BY p.id_producto, p.nombre, p.categoria
      ORDER BY total_personalizaciones DESC
      LIMIT 5;
    `

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
    })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Error al obtener estadísticas', error: error.message })
  }
}

// 9. Agregar productos a un pedido existente
// export const agregarProductosAlPedido = async (req, res) => {
//   const { id } = req.params
//   const { productos } = req.body

//   if (!productos || !Array.isArray(productos) || productos.length === 0) {
//     return res.status(400).json({
//       status: 'ERROR',
//       message: 'Debe incluir al menos un producto para agregar al pedido'
//     })
//   }

//   try {
//     const pedidoExistente = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`
//     if (pedidoExistente.length === 0)
//       return res.status(404).json({ status: 'ERROR', message: `No se encontró el pedido con ID ${id}` })

//     if (['entregado', 'cancelado'].includes(pedidoExistente[0].estado))
//       return res.status(400).json({
//         status: 'ERROR',
//         message: `No se pueden agregar productos a un pedido en estado "${pedidoExistente[0].estado}"`
//       })

//     return await sql.begin(async (sql) => {
//       let totalAdicional = 0
//       const productosAgregados = []

//       for (const producto of productos) {
//         const productoInfo = await sql`
//           SELECT * FROM productos WHERE id_producto = ${producto.id_producto} AND disponible = TRUE;
//         `
//         if (productoInfo.length === 0)
//           throw new Error(`El producto con ID ${producto.id_producto} no existe o no está disponible`)

//         let subtotal = productoInfo[0].precio_base

//         if (producto.ingredientes_personalizados) {
//           for (const ingrediente of producto.ingredientes_personalizados) {
//             if (ingrediente.es_extra) {
//               const ingredienteInfo = await sql`
//                 SELECT * FROM ingredientes WHERE id_ingrediente = ${ingrediente.id_ingrediente};
//               `
//               if (ingredienteInfo.length === 0)
//                 throw new Error(`El ingrediente con ID ${ingrediente.id_ingrediente} no existe`)
//               subtotal += ingredienteInfo[0].precio * ingrediente.cantidad
//             }
//           }
//         }

//         totalAdicional += subtotal

//         const nuevoPedidoProducto = await sql`
//           INSERT INTO pedidos_productos (id_pedido, id_producto, subtotal, notas)
//           VALUES (${id}, ${producto.id_producto}, ${subtotal}, ${producto.notas || null})
//           RETURNING *;
//         `

//         productosAgregados.push(nuevoPedidoProducto[0])

//         if (producto.ingredientes_personalizados) {
//           for (const ingrediente of producto.ingredientes_personalizados) {
//             await sql`
//               INSERT INTO pedidos_productos_ingredientes (
//                 id_pedido_producto, id_ingrediente, cantidad, es_extra
//               )
//               VALUES (
//                 ${nuevoPedidoProducto[0].id_pedido_producto},
//                 ${ingrediente.id_ingrediente},
//                 ${ingrediente.cantidad},
//                 ${ingrediente.es_extra}
//               );
//             `
//           }
//         }
//       }

//       const nuevoTotal = pedidoExistente[0].total + totalAdicional
//       const pedidoActualizado = await sql`
//         UPDATE pedidos SET total = ${nuevoTotal} WHERE id_pedido = ${id} RETURNING *;
//       `

//       return res.json({
//         status: 'OK',
//         message: 'Productos agregados correctamente al pedido',
//         data: {
//           pedido: pedidoActualizado[0],
//           productos_agregados: productosAgregados,
//           total_adicional: totalAdicional
//         }
//       })
//     })
//   } catch (error) {
//     res.status(500).json({ status: 'ERROR', message: `Error al agregar productos al pedido`, error: error.message })
//   }
// }
export const agregarProductosAlPedido = async (req, res) => {
  const { id } = req.params
  const { productos } = req.body

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe incluir al menos un producto para agregar al pedido'
    })
  }

  try {
    const pedidoExistente = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`
    if (pedidoExistente.length === 0)
      return res.status(404).json({ status: 'ERROR', message: `No se encontró el pedido con ID ${id}` })

    if (['entregado', 'cancelado'].includes(pedidoExistente[0].estado))
      return res.status(400).json({
        status: 'ERROR',
        message: `No se pueden agregar productos a un pedido en estado "${pedidoExistente[0].estado}"`
      })

    return await sql.begin(async (sql) => {
      let totalAdicional = 0
      const productosAgregados = []

      for (const producto of productos) {
        const productoInfo = await sql`
          SELECT * FROM productos WHERE id_producto = ${producto.id_producto} AND disponible = TRUE;
        `
        if (productoInfo.length === 0)
          throw new Error(`El producto con ID ${producto.id_producto} no existe o no está disponible`)

        let subtotal = productoInfo[0].precio_base

        if (producto.ingredientes_personalizados) {
          for (const ingrediente of producto.ingredientes_personalizados) {
            const ingredienteInfo = await sql`
              SELECT * FROM ingredientes WHERE id_ingrediente = ${ingrediente.id_ingrediente};
            `
            if (ingredienteInfo.length === 0)
              throw new Error(`El ingrediente con ID ${ingrediente.id_ingrediente} no existe`)

            // Sumamos solo si es extra y cantidad positiva (precio extra)
            if (ingrediente.cantidad > 0 && ingrediente.es_extra) {
              subtotal += ingredienteInfo[0].precio * ingrediente.cantidad
            }
            // Si cantidad es negativa (remoción), no sumamos nada al subtotal
          }
        }

        totalAdicional += subtotal

        const nuevoPedidoProducto = await sql`
          INSERT INTO pedidos_productos (id_pedido, id_producto, subtotal, notas)
          VALUES (${id}, ${producto.id_producto}, ${subtotal}, ${producto.notas || null})
          RETURNING *;
        `

        productosAgregados.push(nuevoPedidoProducto[0])

        if (producto.ingredientes_personalizados) {
          for (const ingrediente of producto.ingredientes_personalizados) {
            await sql`
              INSERT INTO pedidos_productos_ingredientes (
                id_pedido_producto, id_ingrediente, cantidad, es_extra
              )
              VALUES (
                ${nuevoPedidoProducto[0].id_pedido_producto},
                ${ingrediente.id_ingrediente},
                ${ingrediente.cantidad},
                ${ingrediente.es_extra}
              );
            `
          }
        }
      }

      const nuevoTotal = pedidoExistente[0].total + totalAdicional
      const pedidoActualizado = await sql`
        UPDATE pedidos SET total = ${nuevoTotal} WHERE id_pedido = ${id} RETURNING *;
      `

      return res.json({
        status: 'OK',
        message: 'Productos agregados correctamente al pedido',
        data: {
          pedido: pedidoActualizado[0],
          productos_agregados: productosAgregados,
          total_adicional: totalAdicional
        }
      })
    })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al agregar productos al pedido`, error: error.message })
  }
}


// 10. Filtrar pedidos por rango de fechas
export const filtrarPedidosPorFecha = async (req, res) => {
  const { desde, hasta } = req.query
  if (!desde || !hasta) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe proporcionar fechas de inicio y fin (desde, hasta) en formato timestamp'
    })
  }

  try {
    const pedidos = await sql`
      SELECT * FROM pedidos
      WHERE fecha_hora >= ${desde} AND fecha_hora <= ${hasta}
      ORDER BY fecha_hora DESC;
    `
    res.json({ status: 'OK', data: pedidos })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Error al filtrar pedidos por fecha', error: error.message })
  }
}

// 11. Obtener resumen de productos en un pedido
export const obtenerResumenPedido = async (req, res) => {
  const { id } = req.params
  try {
    const pedido = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`
    if (pedido.length === 0)
      return res.status(404).json({ status: 'ERROR', message: `No se encontró el pedido con ID ${id}` })

    const resumenProductos = await sql`
      SELECT p.id_producto, p.nombre, p.categoria, p.precio_base,
             COUNT(pp.id_pedido_producto) as cantidad_total,
             SUM(pp.subtotal) as subtotal_total,
             AVG(pp.subtotal) as precio_promedio_personalizado
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      WHERE pp.id_pedido = ${id}
      GROUP BY p.id_producto, p.nombre, p.categoria, p.precio_base
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

export const getPedidosPorMetodoPago = async (req, res) => {
  const { metodo } = req.params
  try {
    const pedidos = await sql`
      SELECT * FROM pedidos
      WHERE metodo_pago = ${metodo}
      ORDER BY fecha_hora DESC;
    `
    res.json({ status: 'OK', data: pedidos })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: `Error al obtener pedidos con método ${metodo}`, error: error.message })
  }
}

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
