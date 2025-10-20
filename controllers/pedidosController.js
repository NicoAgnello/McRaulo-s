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


// 3. Crear nuevo pedido (desacoplado del pago: solo efectivo crea compra)
export const createPedido = async (req, res) => {
  const { productos, metodo_pago, id_metodo_pago, id_cliente } = req.body;

  if (!productos || !Array.isArray(productos) || productos.length === 0)
    return res.status(400).json({ status: 'ERROR', message: 'Debe incluir al menos un producto en el pedido' });
  if (!id_cliente)
    return res.status(400).json({ status: 'ERROR', message: 'Debe incluir el ID del cliente' });
  if (!id_metodo_pago && !metodo_pago)
    return res.status(400).json({ status: 'ERROR', message: 'Debe especificar el método de pago (id_metodo_pago o metodo_pago)' });

  try {
    // Cliente
    const cli = await sql`SELECT 1 FROM clientes WHERE id_cliente = ${id_cliente}`;
    if (cli.length === 0) return res.status(400).json({ status: 'ERROR', message: `El cliente ${id_cliente} no existe` });

    // Resolver método (por id o por nombre)
    let mp;
    if (id_metodo_pago) {
      const r = await sql`SELECT id_metodo_pago, LOWER(nombre) AS nombre FROM metodo_pago WHERE id_metodo_pago = ${id_metodo_pago}`;
      if (r.length === 0) return res.status(400).json({ status: 'ERROR', message: `id_metodo_pago ${id_metodo_pago} inválido` });
      mp = r[0];
    } else {
      const r = await sql`SELECT id_metodo_pago, LOWER(nombre) AS nombre FROM metodo_pago WHERE LOWER(nombre) = LOWER(${metodo_pago})`;
      if (r.length === 0) return res.status(400).json({ status: 'ERROR', message: `metodo_pago "${metodo_pago}" inválido` });
      mp = r[0];
    }

    // Transacción
    return await sql.begin(async (tx) => {
      // (opcional) mapear id de estado 'pendiente'
      let estadoPendienteId = null;
      try {
        const e = await tx`SELECT id_estado FROM estado WHERE LOWER(nombre)='pendiente' LIMIT 1`;
        if (e.length > 0) estadoPendienteId = e[0].id_estado;
      } catch (_) {}

      // Calcular total con validaciones (mismo criterio que ya veníamos usando)
      let total = 0;
      for (const prod of productos) {
        const [p] = await tx`
          SELECT p.id_producto, p.nombre, p.precio_base::float AS precio_base,
                 c.permite_extras
          FROM productos p
          LEFT JOIN categoria c ON c.id_categoria = p.id_categoria
          WHERE p.id_producto = ${prod.id_producto} AND p.disponible = TRUE
        `;
        if (!p) return res.status(400).json({ status: 'ERROR', message: `Producto ${prod.id_producto} inexistente o no disponible` });

        const lista = Array.isArray(prod.ingredientes_personalizados) ? prod.ingredientes_personalizados : [];
        for (const ing of lista) {
          if (typeof ing.id_ingrediente !== 'number') return res.status(400).json({ status: 'ERROR', message: `Falta id_ingrediente en una personalización` });
          if (typeof ing.cantidad !== 'number' || ing.cantidad <= 0) return res.status(400).json({ status: 'ERROR', message: `La cantidad debe ser > 0 para el ingrediente ${ing.id_ingrediente}` });
          if (typeof ing.es_extra !== 'boolean') ing.es_extra = !!ing.es_extra;
        }

        // Bloquear extras si la categoría no lo permite
        if (p.permite_extras === false && lista.some(i => i.es_extra && i.cantidad > 0)) {
          return res.status(400).json({ status: 'ERROR', message: `El producto "${p.nombre}" no admite extras` });
        }

        // Si hay remociones, verificar contra receta base
        if (lista.some(i => !i.es_extra)) {
          const baseRows = await tx`
            SELECT id_ingrediente FROM productos_ingredientes_base WHERE id_producto = ${prod.id_producto}
          `;
          const baseSet = new Set(baseRows.map(r => r.id_ingrediente));
          for (const ing of lista) {
            if (!ing.es_extra && !baseSet.has(ing.id_ingrediente)) {
              return res.status(400).json({ status: 'ERROR', message: `No se puede remover el ingrediente ${ing.id_ingrediente} en "${p.nombre}" porque no está en la receta base` });
            }
          }
        }

        // Subtotal = base + extras
        let subtotal = p.precio_base;
        for (const ing of lista) {
          if (!ing.es_extra) continue;
          const [ingRow] = await tx`SELECT precio::float AS precio FROM ingredientes WHERE id_ingrediente = ${ing.id_ingrediente}`;
          if (!ingRow) return res.status(400).json({ status: 'ERROR', message: `Ingrediente ${ing.id_ingrediente} inexistente` });
          subtotal += ingRow.precio * ing.cantidad;
        }
        prod.subtotal = subtotal;
        total += subtotal;
      }

      // Insertar pedido
      let nuevoPedido;
      if (estadoPendienteId !== null) {
        [nuevoPedido] = await tx`
          INSERT INTO pedidos (fecha_hora, estado, total, id_cliente, estado_actual)
          VALUES (NOW(), 'pendiente', ${total}, ${id_cliente}, ${estadoPendienteId})
          RETURNING *;
        `;
      } else {
        [nuevoPedido] = await tx`
          INSERT INTO pedidos (fecha_hora, estado, total, id_cliente)
          VALUES (NOW(), 'pendiente', ${total}, ${id_cliente})
          RETURNING *;
        `;
      }

      // Insertar líneas + personalizaciones
      for (const prod of productos) {
        const [pp] = await tx`
          INSERT INTO pedidos_productos (id_pedido, id_producto, subtotal, notas)
          VALUES (${nuevoPedido.id_pedido}, ${prod.id_producto}, ${prod.subtotal}, ${prod.notas || null})
          RETURNING *;
        `;
        const lista = Array.isArray(prod.ingredientes_personalizados) ? prod.ingredientes_personalizados : [];
        for (const ing of lista) {
          await tx`
            INSERT INTO pedidos_productos_ingredientes (id_pedido_producto, id_ingrediente, cantidad, es_extra)
            VALUES (${pp.id_pedido_producto}, ${ing.id_ingrediente}, ${ing.cantidad}, ${ing.es_extra});
          `;
        }
      }

      // ⚠️ Compra SOLO si es EFECTIVO
      if (mp.nombre === 'efectivo') {
        await tx`INSERT INTO compra (id_pedido, id_metodo_pago) VALUES (${nuevoPedido.id_pedido}, ${mp.id_metodo_pago});`;
      }

      // Datos de cliente
      const [cliente] = await tx`SELECT id_cliente, nombre, email FROM clientes WHERE id_cliente = ${id_cliente};`;

      return res.status(201).json({
        status: 'OK',
        message: mp.nombre === 'efectivo'
          ? 'Pedido creado correctamente (pago en efectivo)'
          : 'Pedido creado correctamente (pago pendiente)',
        data: { pedido: nuevoPedido, cliente, productos }
      });
    });
  } catch (error) {
    console.error('Error al crear pedido:', error);
    return res.status(500).json({ status: 'ERROR', message: 'Error al crear el pedido', error: error.message });
  }
};

// 4. Actualizar estado de un pedido
export const updateEstadoPedido = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  const estadosValidos = ['pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado'];
  if (!estado || !estadosValidos.includes(estado)) {
    return res.status(400).json({
      status: 'ERROR',
      message: `Estado inválido. Debe ser uno de: ${estadosValidos.join(', ')}`
    });
  }

  try {
    const pedidoRows = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`;
    if (pedidoRows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: `No se encontró el pedido con ID ${id}` });
    }

    const pedido = pedidoRows[0];

    // ❗ Evitar cambiar al mismo estado
    if (pedido.estado === estado) {
      return res.status(409).json({
        status: 'ERROR',
        message: `El pedido ya se encuentra en estado "${estado}"`
      });
    }

    // ❗ Bloquear cambios si ya está finalizado
    if (['entregado', 'cancelado'].includes(pedido.estado)) {
      return res.status(400).json({
        status: 'ERROR',
        message: `No se puede cambiar el estado de un pedido "${pedido.estado}"`
      });
    }

    // Transacción para actualizar estado + opcionalmente historial
    await sql.begin(async (tx) => {
      // Intentar usar tabla 'estado' y columna 'estado_actual' si existen
      let idEstadoNuevo = null;
      try {
        const e = await tx`
          SELECT id_estado FROM estado WHERE LOWER(nombre) = LOWER(${estado}) LIMIT 1;
        `;
        if (e.length > 0) idEstadoNuevo = e[0].id_estado;
      } catch (_) { /* si no existe la tabla 'estado', seguimos */ }

      if (idEstadoNuevo !== null) {
        // Actualiza estado string + id de estado actual si existe la columna
        try {
          await tx`
            UPDATE pedidos
            SET estado = ${estado}, estado_actual = ${idEstadoNuevo}
            WHERE id_pedido = ${id};
          `;
        } catch (_) {
          // Si no existe estado_actual, actualizamos solo el string
          await tx`UPDATE pedidos SET estado = ${estado} WHERE id_pedido = ${id};`;
        }

        // Registrar historial si existe tabla 'estado_pedido'
        try {
          await tx`
            INSERT INTO estado_pedido (id_pedido, id_estado, fecha_hora)
            VALUES (${id}, ${idEstadoNuevo}, NOW());
          `;
        } catch (_) { /* si no existe la tabla/columnas, no rompemos */ }
      } else {
        // Fallback: solo actualiza el string del estado
        await tx`UPDATE pedidos SET estado = ${estado} WHERE id_pedido = ${id};`;
      }
    });

    // Traer pedido actualizado con datos del cliente
    const pedidoConCliente = await sql`
      SELECT p.*, c.nombre AS cliente_nombre, c.email AS cliente_email
      FROM pedidos p
      JOIN clientes c ON p.id_cliente = c.id_cliente
      WHERE p.id_pedido = ${id};
    `;

    // Traer productos con ingredientes
    const productos = await sql`
      SELECT pp.*, p.nombre, p.descripcion, p.id_categoria
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      WHERE pp.id_pedido = ${id};
    `;

    const productosConIngredientes = await Promise.all(
      productos.map(async (prod) => {
        const ingredientes = await sql`
          SELECT ppi.*, i.nombre, i.descripcion, i.unidad_medida
          FROM pedidos_productos_ingredientes ppi
          JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
          WHERE ppi.id_pedido_producto = ${prod.id_pedido_producto};
        `;
        return { ...prod, ingredientes_personalizados: ingredientes };
      })
    );

    return res.json({
      status: 'OK',
      message: `Estado actualizado a "${estado}"`,
      data: { ...pedidoConCliente[0], productos: productosConIngredientes }
    });
  } catch (error) {
    console.error(`Error al actualizar estado del pedido ${id}:`, error);
    return res.status(500).json({
      status: 'ERROR',
      message: `Error al actualizar estado del pedido ${id}`,
      error: error.message
    });
  }
};


// 5. Eliminar un pedido 
export const deletePedido = async (req, res) => {
  const { id } = req.params;

  try {
    const pedRows = await sql`SELECT id_pedido, estado FROM pedidos WHERE id_pedido = ${id};`;
    if (pedRows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: `Pedido con ID ${id} no existe` });
    }
    if (pedRows[0].estado === 'entregado') {
      return res.status(400).json({ status: 'ERROR', message: 'No se puede eliminar un pedido entregado. Cancélalo primero.' });
    }

    await sql.begin(async (tx) => {
      // compra (si existe)
      try { await tx`DELETE FROM compra WHERE id_pedido = ${id};`; } catch (_) {}

      // historial de estados (si existe)
      try { await tx`DELETE FROM estado_pedido WHERE id_pedido = ${id};`; } catch (_) {}

      // ingredientes de todas las líneas del pedido
      await tx`
        DELETE FROM pedidos_productos_ingredientes
        WHERE id_pedido_producto IN (
          SELECT id_pedido_producto FROM pedidos_productos WHERE id_pedido = ${id}
        );
      `;

      // líneas del pedido
      await tx`DELETE FROM pedidos_productos WHERE id_pedido = ${id};`;

      // pedido
      const [deleted] = await tx`DELETE FROM pedidos WHERE id_pedido = ${id} RETURNING *;`;

      return res.json({
        status: 'OK',
        message: `Pedido ${id} eliminado correctamente`,
        data: deleted
      });
    });
  } catch (error) {
    return res
      .status(500)
      .json({ status: 'ERROR', message: `Error al eliminar pedido ${id}`, error: error.message });
  }
};

// PATCH /api/pedidos/:id/cancelar
export const cancelarPedido = async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body || {};

  try {
    const pedRows = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`;
    if (pedRows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: `Pedido ${id} no existe` });
    }
    const pedido = pedRows[0];

    if (pedido.estado === 'cancelado') {
      return res.status(409).json({ status: 'ERROR', message: 'El pedido ya está cancelado' });
    }
    if (pedido.estado === 'entregado') {
      return res.status(400).json({ status: 'ERROR', message: 'No se puede cancelar un pedido entregado' });
    }

    await sql.begin(async (tx) => {
      // intentar usar tabla de estados para estado_actual
      let idEstadoCancelado = null;
      try {
        const e = await tx`SELECT id_estado FROM estado WHERE LOWER(nombre)=LOWER('cancelado') LIMIT 1;`;
        if (e.length > 0) idEstadoCancelado = e[0].id_estado;
      } catch (_) {}

      if (idEstadoCancelado !== null) {
        try {
          await tx`
            UPDATE pedidos
            SET estado = 'cancelado', estado_actual = ${idEstadoCancelado}
            WHERE id_pedido = ${id};
          `;
        } catch (_) {
          await tx`UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = ${id};`;
        }
        try {
          await tx`
            INSERT INTO estado_pedido (id_pedido, id_estado, fecha_hora, motivo)
            VALUES (${id}, ${idEstadoCancelado}, NOW(), ${motivo || null});
          `;
        } catch (_) {}
      } else {
        await tx`UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = ${id};`;
      }

      // si había compra registrada, la quitamos para que no cuente en ventas
      try { await tx`DELETE FROM compra WHERE id_pedido = ${id};`; } catch (_) {}
    });

    // devolver pedido actualizado
    const [pedidoAct] = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id};`;
    return res.json({ status: 'OK', message: 'Pedido cancelado', data: pedidoAct });
  } catch (error) {
    return res
      .status(500)
      .json({ status: 'ERROR', message: `Error al cancelar pedido ${id}`, error: error.message });
  }
};


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

// GET /api/pedidos/:idPedido/productos-por-id/:idProducto
export const getProductosAgrupadosEnPedido = async (req, res) => {
  const { idPedido, idProducto } = req.params;

  try {
    const lineas = await sql`
      SELECT pp.*,
             p.nombre,
             p.descripcion,
             c.nombre AS categoria
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      LEFT JOIN categoria c ON p.id_categoria = c.id_categoria
      WHERE pp.id_pedido = ${idPedido}
        AND pp.id_producto = ${idProducto}
      ORDER BY pp.id_pedido_producto;
    `;

    // Si preferís 200 con [] en lugar de 404, cambialo acá
    if (lineas.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: 'No hay líneas con ese producto en el pedido' });
    }

    const conIngredientes = await Promise.all(
      lineas.map(async (l) => {
        const ingredientes = await sql`
          SELECT ppi.*, i.nombre, i.descripcion, i.unidad_medida
          FROM pedidos_productos_ingredientes ppi
          JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
          WHERE ppi.id_pedido_producto = ${l.id_pedido_producto};
        `;
        return {
          ...l,
          ingredientes_extra: ingredientes.filter(i => i.es_extra),
          ingredientes_removidos: ingredientes.filter(i => !i.es_extra)
        };
      })
    );

    return res.json({ status: 'OK', data: conIngredientes });
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      message: 'Error al obtener líneas por producto',
      error: error.message
    });
  }
};


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

// 9. Agregar producto al pedido
export const agregarProductosAlPedido = async (req, res) => {
  const { id } = req.params;            // id_pedido
  const { productos } = req.body;

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe incluir al menos un producto para agregar al pedido'
    });
  }

  try {
    const pedidoRows = await sql`
      SELECT id_pedido, estado, total::float AS total
      FROM pedidos
      WHERE id_pedido = ${id};
    `;
    if (pedidoRows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: `No se encontró el pedido con ID ${id}` });
    }
    const pedido = pedidoRows[0];

    if (['entregado', 'cancelado'].includes(pedido.estado)) {
      return res.status(400).json({
        status: 'ERROR',
        message: `No se pueden agregar productos a un pedido en estado "${pedido.estado}"`
      });
    }

    return await sql.begin(async (tx) => {
      let totalAdicional = 0;
      const productosAgregados = [];

      for (const prod of productos) {
        // 1) Traer producto + categoría (permite_extras) y precio_base ya como number
        const rows = await tx`
          SELECT p.id_producto, p.nombre, p.precio_base::float AS precio_base,
                 COALESCE(c.permite_extras, TRUE) AS permite_extras
          FROM productos p
          LEFT JOIN categoria c ON c.id_categoria = p.id_categoria
          WHERE p.id_producto = ${prod.id_producto} AND p.disponible = TRUE;
        `;
        if (rows.length === 0) {
          return res.status(400).json({
            status: 'ERROR',
            message: `Producto ${prod.id_producto} inexistente o no disponible`
          });
        }
        const p = rows[0];

        // 2) Normalizar/validar la lista de personalizaciones
        const lista = Array.isArray(prod.ingredientes_personalizados)
          ? prod.ingredientes_personalizados
          : [];

        for (const ing of lista) {
          if (typeof ing.id_ingrediente !== 'number') {
            return res.status(400).json({
              status: 'ERROR',
              message: `Falta id_ingrediente en una personalización de "${p.nombre}"`
            });
          }
          if (typeof ing.cantidad !== 'number' || ing.cantidad <= 0) {
            return res.status(400).json({
              status: 'ERROR',
              message: `La cantidad debe ser > 0 para el ingrediente ${ing.id_ingrediente} en "${p.nombre}"`
            });
          }
          if (typeof ing.es_extra !== 'boolean') ing.es_extra = !!ing.es_extra;
        }

        // 3) Bloquear extras si la categoría no los permite
        const hayExtras = lista.some(i => i.es_extra && i.cantidad > 0);
        if (p.permite_extras === false && hayExtras) {
          return res.status(400).json({
            status: 'ERROR',
            message: `El producto "${p.nombre}" no admite extras`
          });
        }

        // 4) Validar remociones contra receta base
        if (lista.some(i => !i.es_extra)) {
          const baseRows = await tx`
            SELECT id_ingrediente
            FROM productos_ingredientes_base
            WHERE id_producto = ${p.id_producto};
          `;
          const baseSet = new Set(baseRows.map(r => r.id_ingrediente));
          for (const ing of lista) {
            if (!ing.es_extra && !baseSet.has(ing.id_ingrediente)) {
              return res.status(400).json({
                status: 'ERROR',
                message: `No se puede remover el ingrediente ${ing.id_ingrediente} en "${p.nombre}" porque no está en la receta base`
              });
            }
          }
        }

        // 5) Calcular subtotal = precio_base + sum(precio_extra * cantidad)
        let subtotal = p.precio_base;
        for (const ing of lista) {
          if (!ing.es_extra) continue; // las remociones no descuentan (tu lógica actual)
          const ingRows = await tx`
            SELECT precio::float AS precio
            FROM ingredientes
            WHERE id_ingrediente = ${ing.id_ingrediente};
          `;
          if (ingRows.length === 0) {
            return res.status(400).json({
              status: 'ERROR',
              message: `Ingrediente ${ing.id_ingrediente} inexistente`
            });
          }
          subtotal += ingRows[0].precio * ing.cantidad;
        }

        totalAdicional += subtotal;

        // 6) Insertar línea de pedido
        const [pp] = await tx`
          INSERT INTO pedidos_productos (id_pedido, id_producto, subtotal, notas)
          VALUES (${id}, ${p.id_producto}, ${subtotal}, ${prod.notas || null})
          RETURNING *;
        `;
        productosAgregados.push(pp);

        // 7) Insertar personalizaciones de la línea
        for (const ing of lista) {
          await tx`
            INSERT INTO pedidos_productos_ingredientes
              (id_pedido_producto, id_ingrediente, cantidad, es_extra)
            VALUES
              (${pp.id_pedido_producto}, ${ing.id_ingrediente}, ${ing.cantidad}, ${ing.es_extra});
          `;
        }
      }

      // 8) Actualizar total del pedido
      const nuevoTotal = (Number.isFinite(pedido.total) ? pedido.total : 0) + totalAdicional;
      const [pedidoActualizado] = await tx`
        UPDATE pedidos SET total = ${nuevoTotal}
        WHERE id_pedido = ${id}
        RETURNING *;
      `;

      return res.json({
        status: 'OK',
        message: 'Productos agregados correctamente al pedido',
        data: {
          pedido: pedidoActualizado,
          productos_agregados: productosAgregados,
          total_adicional: totalAdicional
        }
      });
    });
  } catch (error) {
    console.error('Error al agregar productos al pedido:', error);
    return res.status(500).json({
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

// Confirmar pago de un pedido (tarjeta / mercadopago)
// POST /api/pedidos/:id/confirmar-pago
// controllers/pedidosController.js
export const confirmarPago = async (req, res) => {
  const { id } = req.params; // id_pedido
  const { metodo_pago, id_metodo_pago } = req.body;

  if (!id_metodo_pago && !metodo_pago) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe indicar el método de pago (id_metodo_pago o metodo_pago)',
    });
  }

  try {
    // 1) Pedido válido y no finalizado
    const pedRows = await sql`SELECT * FROM pedidos WHERE id_pedido = ${id}`;
    if (pedRows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: `Pedido ${id} no existe` });
    }
    const pedido = pedRows[0];
    if (['cancelado', 'entregado'].includes(pedido.estado)) {
      return res.status(400).json({
        status: 'ERROR',
        message: `No se puede confirmar pago para un pedido "${pedido.estado}"`,
      });
    }

    // 2) Resolver método de pago
    let mp;
    if (id_metodo_pago) {
      const r = await sql`
        SELECT id_metodo_pago, LOWER(nombre) AS nombre
        FROM metodo_pago
        WHERE id_metodo_pago = ${id_metodo_pago}
        LIMIT 1;
      `;
      if (r.length === 0) {
        return res.status(400).json({
          status: 'ERROR',
          message: `id_metodo_pago ${id_metodo_pago} inválido`,
        });
      }
      mp = r[0];
    } else {
      const r = await sql`
        SELECT id_metodo_pago, LOWER(nombre) AS nombre
        FROM metodo_pago
        WHERE LOWER(nombre) = LOWER(${metodo_pago})
        LIMIT 1;
      `;
      if (r.length === 0) {
        return res.status(400).json({
          status: 'ERROR',
          message: `metodo_pago "${metodo_pago}" inválido`,
        });
      }
      mp = r[0];
    }

    // Este endpoint sólo para tarjeta / mercadopago; efectivo se registra al crear el pedido
    if (mp.nombre === 'efectivo') {
      return res.status(400).json({
        status: 'ERROR',
        message: 'El pago en efectivo se registra al crear el pedido',
      });
    }

    // 3) Transacción: crear compra (si no existe) + mover estado a "en_preparacion"
    return await sql.begin(async (tx) => {
      // 3.a) Insert de compra (requiere índice único en compra(id_pedido))
      const compraInsert = await tx`
        INSERT INTO compra (id_pedido, id_metodo_pago, fecha)
        VALUES (${id}, ${mp.id_metodo_pago}, NOW())
        ON CONFLICT (id_pedido) DO NOTHING
        RETURNING *;
      `;
      if (compraInsert.length === 0) {
        const ya = await tx`SELECT * FROM compra WHERE id_pedido = ${id}`;
        return res.status(409).json({
          status: 'ERROR',
          message: 'El pedido ya tiene una compra registrada',
          data: ya[0],
        });
      }

      // 3.b) Resolver id de estado "en_preparacion" si existe tabla 'estado'
      let idEstadoNuevo = null;
      try {
        const e = await tx`
          SELECT id_estado
          FROM estado
          WHERE LOWER(nombre) = 'en_preparacion'
          LIMIT 1;
        `;
        if (e.length > 0) idEstadoNuevo = e[0].id_estado;
      } catch (_) {}

      // 3.c) Actualizar estado (string + FK si existe 'estado_actual')
      if (idEstadoNuevo !== null) {
        try {
          await tx`
            UPDATE pedidos
            SET estado = 'en_preparacion',
                estado_actual = ${idEstadoNuevo}
            WHERE id_pedido = ${id};
          `;
        } catch (_) {
          await tx`
            UPDATE pedidos
            SET estado = 'en_preparacion'
            WHERE id_pedido = ${id};
          `;
        }

        // Historial: usa fecha_ingreso / fecha_salida (NULL)
        try {
          await tx`
            INSERT INTO estado_pedido (id_pedido, id_estado, fecha_ingreso, fecha_salida)
            VALUES (${id}, ${idEstadoNuevo}, NOW(), NULL);
          `;
        } catch (_) {
          // No crítico; no frenamos el flujo si fallara el historial
        }
      } else {
        // Sin tabla/relación de estados: al menos actualizamos el string
        try {
          await tx`
            UPDATE pedidos
            SET estado = 'en_preparacion'
            WHERE id_pedido = ${id};
          `;
        } catch (_) {}
      }

      const [pedidoActualizado] =
        await tx`SELECT * FROM pedidos WHERE id_pedido = ${id}`;

      return res.json({
        status: 'OK',
        message: 'Pago confirmado',
        data: {
          pedido: pedidoActualizado,
          compra: compraInsert[0],
          metodo_pago: mp,
        },
      });
    });
  } catch (error) {
    console.error('Error al confirmar pago:', error);
    return res.status(500).json({
      status: 'ERROR',
      message: 'Error al confirmar pago',
      error: error.message,
    });
  }
};

