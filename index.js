// index.js
import express from 'express';
import dotenv from 'dotenv';
import sql, { testConnection } from './db.js';

// Cargar variables de entorno
dotenv.config();

// Crear aplicación Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

// Verificar que el servidor está funcionando
app.get('/', (req, res) => {
  res.json({
    message: 'API de Autoservicio de Hamburguesas',
    status: 'OK',
    timestamp: new Date()
  });
});

// Verificar la conexión a la base de datos
app.get('/db-test', async (req, res) => {
  try {
    // Testear la conexión
    const isConnected = await testConnection();
    
    if (isConnected) {
      // Si la conexión es exitosa, obtener información de las tablas
      const tables = await sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `;
      
      res.json({
        status: 'OK',
        message: 'Conexión exitosa a la base de datos',
        tables: tables.map(t => t.table_name)
      });
    } else {
      res.status(500).json({
        status: 'ERROR',
        message: 'No se pudo conectar a la base de datos'
      });
    }
  } catch (error) {
    console.error('Error al verificar la conexión:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Error al verificar la conexión a la base de datos',
      error: error.message
    });
  }
});

// --- ENDPOINTS DE PEDIDOS ---

// 1. Obtener todos los pedidos
app.get('/api/pedidos', async (req, res) => {
  try {
    const pedidos = await sql`
      SELECT * FROM pedidos
      ORDER BY fecha_hora DESC;
    `;
    
    res.json({
      status: 'OK',
      data: pedidos
    });
  } catch (error) {
    console.error('Error al obtener pedidos:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Error al obtener pedidos',
      error: error.message
    });
  }
});

// 2. Obtener un pedido específico con detalles completos
app.get('/api/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Obtener la información del pedido
    const pedido = await sql`
      SELECT * FROM pedidos
      WHERE id_pedido = ${id};
    `;
    
    if (pedido.length === 0) {
      return res.status(404).json({
        status: 'ERROR',
        message: `No se encontró el pedido con ID ${id}`
      });
    }
    
    // Obtener los productos del pedido con sus detalles
    const productos = await sql`
      SELECT pp.*, p.nombre, p.descripcion, p.categoria
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      WHERE pp.id_pedido = ${id};
    `;
    
    // Para cada producto, obtener los ingredientes personalizados
    const productosConIngredientes = await Promise.all(
      productos.map(async (producto) => {
        const ingredientes = await sql`
          SELECT ppi.*, i.nombre, i.descripcion, i.unidad_medida
          FROM pedidos_productos_ingredientes ppi
          JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
          WHERE ppi.id_pedido_producto = ${producto.id_pedido_producto};
        `;
        
        return {
          ...producto,
          ingredientes_personalizados: ingredientes
        };
      })
    );
    
    res.json({
      status: 'OK',
      data: {
        ...pedido[0],
        productos: productosConIngredientes
      }
    });
  } catch (error) {
    console.error(`Error al obtener detalle del pedido ${id}:`, error);
    res.status(500).json({
      status: 'ERROR',
      message: `Error al obtener detalle del pedido ${id}`,
      error: error.message
    });
  }
});

// 3. Crear un nuevo pedido
app.post('/api/pedidos', async (req, res) => {
  const { productos, metodo_pago } = req.body;
  
  // Validaciones básicas
  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe incluir al menos un producto en el pedido'
    });
  }
  
  if (!metodo_pago) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe especificar el método de pago'
    });
  }
  
  // Usar transacción para garantizar la integridad
  try {
    return await sql.begin(async (sql) => {
      // 1. Calcular el total del pedido
      let total = 0;
      
      // Calcular subtotales por cada producto
      for (const producto of productos) {
        // Verificar que el producto existe y está disponible
        const productoInfo = await sql`
          SELECT * FROM productos 
          WHERE id_producto = ${producto.id_producto} 
          AND disponible = TRUE;
        `;
        
        if (productoInfo.length === 0) {
          throw new Error(`El producto con ID ${producto.id_producto} no existe o no está disponible`);
        }
        
        // Calcular precio base
        let subtotal = productoInfo[0].precio_base * producto.cantidad;
        
        // Calcular precios de ingredientes extras
        if (producto.ingredientes_personalizados && producto.ingredientes_personalizados.length > 0) {
          for (const ingrediente of producto.ingredientes_personalizados) {
            // Solo calcular para ingredientes extras
            if (ingrediente.es_extra) {
              const ingredienteInfo = await sql`
                SELECT * FROM ingredientes
                WHERE id_ingrediente = ${ingrediente.id_ingrediente};
              `;
              
              if (ingredienteInfo.length === 0) {
                throw new Error(`El ingrediente con ID ${ingrediente.id_ingrediente} no existe`);
              }
              
              // Agregar costo de ingrediente extra
              subtotal += ingredienteInfo[0].precio * ingrediente.cantidad;
            }
          }
        }
        
        // Actualizar subtotal del producto
        producto.subtotal = subtotal;
        total += subtotal;
      }
      
      // 2. Crear nuevo pedido
      const fechaHora = Math.floor(Date.now() / 1000); // Timestamp actual en segundos
      
      const nuevoPedido = await sql`
        INSERT INTO pedidos (fecha_hora, estado, total, metodo_pago)
        VALUES (${fechaHora}, 'pendiente', ${total}, ${metodo_pago})
        RETURNING *;
      `;
      
      // 3. Insertar productos del pedido
      for (const producto of productos) {
        const nuevoPedidoProducto = await sql`
          INSERT INTO pedidos_productos (id_pedido, id_producto, cantidad, subtotal, notas)
          VALUES (
            ${nuevoPedido[0].id_pedido}, 
            ${producto.id_producto}, 
            ${producto.cantidad}, 
            ${producto.subtotal}, 
            ${producto.notas || null}
          )
          RETURNING *;
        `;
        
        // 4. Insertar ingredientes personalizados
        if (producto.ingredientes_personalizados && producto.ingredientes_personalizados.length > 0) {
          for (const ingrediente of producto.ingredientes_personalizados) {
            await sql`
              INSERT INTO pedidos_productos_ingredientes (
                id_pedido_producto, 
                id_ingrediente, 
                cantidad, 
                es_extra
              )
              VALUES (
                ${nuevoPedidoProducto[0].id_pedido_producto}, 
                ${ingrediente.id_ingrediente}, 
                ${ingrediente.cantidad}, 
                ${ingrediente.es_extra}
              );
            `;
          }
        }
      }
      
      // 5. Devolver el pedido creado con todos sus detalles
      return res.status(201).json({
        status: 'OK',
        message: 'Pedido creado correctamente',
        data: {
          id_pedido: nuevoPedido[0].id_pedido,
          fecha_hora: nuevoPedido[0].fecha_hora,
          estado: nuevoPedido[0].estado,
          total: nuevoPedido[0].total,
          metodo_pago: nuevoPedido[0].metodo_pago
        }
      });
    });
  } catch (error) {
    console.error('Error al crear el pedido:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Error al crear el pedido',
      error: error.message
    });
  }
});

// 4. Actualizar el estado de un pedido
app.patch('/api/pedidos/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  
  // Validar estados válidos
  const estadosValidos = ['pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado'];
  
  if (!estado || !estadosValidos.includes(estado)) {
    return res.status(400).json({
      status: 'ERROR',
      message: `Estado inválido. Debe ser uno de: ${estadosValidos.join(', ')}`
    });
  }
  
  try {
    // Verificar que el pedido existe
    const pedidoExistente = await sql`
      SELECT * FROM pedidos
      WHERE id_pedido = ${id};
    `;
    
    if (pedidoExistente.length === 0) {
      return res.status(404).json({
        status: 'ERROR',
        message: `No se encontró el pedido con ID ${id}`
      });
    }
    
    // Actualizar el estado
    const pedidoActualizado = await sql`
      UPDATE pedidos
      SET estado = ${estado}
      WHERE id_pedido = ${id}
      RETURNING *;
    `;
    
    res.json({
      status: 'OK',
      message: `Estado del pedido actualizado a "${estado}"`,
      data: pedidoActualizado[0]
    });
  } catch (error) {
    console.error(`Error al actualizar estado del pedido ${id}:`, error);
    res.status(500).json({
      status: 'ERROR',
      message: `Error al actualizar estado del pedido ${id}`,
      error: error.message
    });
  }
});

// 5. Eliminar un pedido
app.delete('/api/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Verificar que el pedido existe
    const pedidoExistente = await sql`
      SELECT * FROM pedidos
      WHERE id_pedido = ${id};
    `;
    
    if (pedidoExistente.length === 0) {
      return res.status(404).json({
        status: 'ERROR',
        message: `No se encontró el pedido con ID ${id}`
      });
    }
    
    // Usar transacción para eliminar en cascada
    return await sql.begin(async (sql) => {
      // 1. Primero, obtener todos los pedidos_productos
      const pedidosProductos = await sql`
        SELECT id_pedido_producto FROM pedidos_productos
        WHERE id_pedido = ${id};
      `;
      
      // 2. Eliminar ingredientes personalizados
      for (const pedidoProducto of pedidosProductos) {
        await sql`
          DELETE FROM pedidos_productos_ingredientes
          WHERE id_pedido_producto = ${pedidoProducto.id_pedido_producto};
        `;
      }
      
      // 3. Eliminar productos del pedido
      await sql`
        DELETE FROM pedidos_productos
        WHERE id_pedido = ${id};
      `;
      
      // 4. Eliminar el pedido
      await sql`
        DELETE FROM pedidos
        WHERE id_pedido = ${id};
      `;
      
      return res.json({
        status: 'OK',
        message: `Pedido con ID ${id} eliminado correctamente`
      });
    });
  } catch (error) {
    console.error(`Error al eliminar el pedido ${id}:`, error);
    res.status(500).json({
      status: 'ERROR',
      message: `Error al eliminar el pedido ${id}`,
      error: error.message
    });
  }
});

// 6. Obtener pedidos por estado
app.get('/api/pedidos/estado/:estado', async (req, res) => {
  const { estado } = req.params;
  
  try {
    const pedidos = await sql`
      SELECT * FROM pedidos
      WHERE estado = ${estado}
      ORDER BY fecha_hora DESC;
    `;
    
    res.json({
      status: 'OK',
      data: pedidos
    });
  } catch (error) {
    console.error(`Error al obtener pedidos con estado ${estado}:`, error);
    res.status(500).json({
      status: 'ERROR',
      message: `Error al obtener pedidos con estado ${estado}`,
      error: error.message
    });
  }
});

// 7. Obtener detalle de un producto específico en un pedido
app.get('/api/pedidos/:idPedido/productos/:idPedidoProducto', async (req, res) => {
  const { idPedido, idPedidoProducto } = req.params;
  
  try {
    // Verificar que el pedido y el producto existen
    const productoEnPedido = await sql`
      SELECT pp.*, p.nombre, p.descripcion, p.categoria
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      WHERE pp.id_pedido = ${idPedido} AND pp.id_pedido_producto = ${idPedidoProducto};
    `;
    
    if (productoEnPedido.length === 0) {
      return res.status(404).json({
        status: 'ERROR',
        message: `No se encontró el producto ${idPedidoProducto} en el pedido ${idPedido}`
      });
    }
    
    // Obtener ingredientes personalizados del producto
    const ingredientes = await sql`
      SELECT ppi.*, i.nombre, i.descripcion, i.unidad_medida
      FROM pedidos_productos_ingredientes ppi
      JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
      WHERE ppi.id_pedido_producto = ${idPedidoProducto};
    `;
    
    // Separar ingredientes extra y removidos
    const ingredientesExtra = ingredientes.filter(ing => ing.es_extra);
    const ingredientesRemovidos = ingredientes.filter(ing => !ing.es_extra);
    
    res.json({
      status: 'OK',
      data: {
        ...productoEnPedido[0],
        ingredientes_extra: ingredientesExtra,
        ingredientes_removidos: ingredientesRemovidos
      }
    });
  } catch (error) {
    console.error(`Error al obtener detalle del producto ${idPedidoProducto} en pedido ${idPedido}:`, error);
    res.status(500).json({
      status: 'ERROR',
      message: `Error al obtener detalle del producto en el pedido`,
      error: error.message
    });
  }
});

// 8. Obtener estadísticas de pedidos
app.get('/api/pedidos/estadisticas/resumen', async (req, res) => {
  try {
    // Total de pedidos
    const totalPedidos = await sql`
      SELECT COUNT(*) as total FROM pedidos;
    `;
    
    // Pedidos por estado
    const pedidosPorEstado = await sql`
      SELECT estado, COUNT(*) as cantidad 
      FROM pedidos 
      GROUP BY estado;
    `;
    
    // Productos más vendidos
    const productosMasVendidos = await sql`
      SELECT p.id_producto, p.nombre, p.categoria, 
             SUM(pp.cantidad) as unidades_vendidas,
             SUM(pp.subtotal) as ventas_totales
      FROM pedidos_productos pp
      JOIN productos p ON pp.id_producto = p.id_producto
      GROUP BY p.id_producto, p.nombre, p.categoria
      ORDER BY unidades_vendidas DESC
      LIMIT 5;
    `;
    
    // Ingredientes extras más solicitados
    const ingredientesMasSolicitados = await sql`
      SELECT i.id_ingrediente, i.nombre, i.unidad_medida,
             SUM(ppi.cantidad) as veces_solicitado
      FROM pedidos_productos_ingredientes ppi
      JOIN ingredientes i ON ppi.id_ingrediente = i.id_ingrediente
      WHERE ppi.es_extra = TRUE
      GROUP BY i.id_ingrediente, i.nombre, i.unidad_medida
      ORDER BY veces_solicitado DESC
      LIMIT 5;
    `;
    
    // Ventas por método de pago
    const ventasPorMetodoPago = await sql`
      SELECT metodo_pago, COUNT(*) as cantidad_pedidos, SUM(total) as total_ventas
      FROM pedidos
      GROUP BY metodo_pago;
    `;
    
    res.json({
      status: 'OK',
      data: {
        total_pedidos: totalPedidos[0].total,
        pedidos_por_estado: pedidosPorEstado,
        productos_mas_vendidos: productosMasVendidos,
        ingredientes_extras_mas_solicitados: ingredientesMasSolicitados,
        ventas_por_metodo_pago: ventasPorMetodoPago
      }
    });
  } catch (error) {
    console.error('Error al obtener estadísticas de pedidos:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Error al obtener estadísticas de pedidos',
      error: error.message
    });
  }
});

// 9. Agregar productos a un pedido existente
app.post('/api/pedidos/:id/productos', async (req, res) => {
  const { id } = req.params;
  const { productos } = req.body;
  
  // Validaciones básicas
  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe incluir al menos un producto para agregar al pedido'
    });
  }
  
  try {
    // Verificar que el pedido existe
    const pedidoExistente = await sql`
      SELECT * FROM pedidos
      WHERE id_pedido = ${id};
    `;
    
    if (pedidoExistente.length === 0) {
      return res.status(404).json({
        status: 'ERROR',
        message: `No se encontró el pedido con ID ${id}`
      });
    }
    
    // Verificar que el pedido no esté en estado "entregado" o "cancelado"
    if (['entregado', 'cancelado'].includes(pedidoExistente[0].estado)) {
      return res.status(400).json({
        status: 'ERROR',
        message: `No se pueden agregar productos a un pedido en estado "${pedidoExistente[0].estado}"`
      });
    }
    
    // Usar transacción
    return await sql.begin(async (sql) => {
      let totalAdicional = 0;
      const productosAgregados = [];
      
      // Calcular subtotales por cada producto
      for (const producto of productos) {
        // Verificar que el producto existe y está disponible
        const productoInfo = await sql`
          SELECT * FROM productos 
          WHERE id_producto = ${producto.id_producto} 
          AND disponible = TRUE;
        `;
        
        if (productoInfo.length === 0) {
          throw new Error(`El producto con ID ${producto.id_producto} no existe o no está disponible`);
        }
        
        // Calcular precio base
        let subtotal = productoInfo[0].precio_base * producto.cantidad;
        
        // Calcular precios de ingredientes extras
        if (producto.ingredientes_personalizados && producto.ingredientes_personalizados.length > 0) {
          for (const ingrediente of producto.ingredientes_personalizados) {
            // Solo calcular para ingredientes extras
            if (ingrediente.es_extra) {
              const ingredienteInfo = await sql`
                SELECT * FROM ingredientes
                WHERE id_ingrediente = ${ingrediente.id_ingrediente};
              `;
              
              if (ingredienteInfo.length === 0) {
                throw new Error(`El ingrediente con ID ${ingrediente.id_ingrediente} no existe`);
              }
              
              // Agregar costo de ingrediente extra
              subtotal += ingredienteInfo[0].precio * ingrediente.cantidad;
            }
          }
        }
        
        // Actualizar subtotal del producto
        producto.subtotal = subtotal;
        totalAdicional += subtotal;
        
        // Insertar producto
        const nuevoPedidoProducto = await sql`
          INSERT INTO pedidos_productos (id_pedido, id_producto, cantidad, subtotal, notas)
          VALUES (
            ${id}, 
            ${producto.id_producto}, 
            ${producto.cantidad}, 
            ${subtotal}, 
            ${producto.notas || null}
          )
          RETURNING *;
        `;
        
        productosAgregados.push(nuevoPedidoProducto[0]);
        
        // Insertar ingredientes personalizados
        if (producto.ingredientes_personalizados && producto.ingredientes_personalizados.length > 0) {
          for (const ingrediente of producto.ingredientes_personalizados) {
            await sql`
              INSERT INTO pedidos_productos_ingredientes (
                id_pedido_producto, 
                id_ingrediente, 
                cantidad, 
                es_extra
              )
              VALUES (
                ${nuevoPedidoProducto[0].id_pedido_producto}, 
                ${ingrediente.id_ingrediente}, 
                ${ingrediente.cantidad}, 
                ${ingrediente.es_extra}
              );
            `;
          }
        }
      }
      
      // Actualizar el total del pedido
      const nuevoTotal = pedidoExistente[0].total + totalAdicional;
      
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
    console.error(`Error al agregar productos al pedido ${id}:`, error);
    res.status(500).json({
      status: 'ERROR',
      message: `Error al agregar productos al pedido ${id}`,
      error: error.message
    });
  }
});

// 10. Filtrar pedidos por rango de fechas
app.get('/api/pedidos/filtro/fecha', async (req, res) => {
  const { desde, hasta } = req.query;
  
  // Validar fechas
  if (!desde || !hasta) {
    return res.status(400).json({
      status: 'ERROR',
      message: 'Debe proporcionar fechas de inicio y fin (desde, hasta) en formato timestamp'
    });
  }
  
  try {
    const pedidos = await sql`
      SELECT * FROM pedidos
      WHERE fecha_hora >= ${desde} AND fecha_hora <= ${hasta}
      ORDER BY fecha_hora DESC;
    `;
    
    res.json({
      status: 'OK',
      data: pedidos
    });
  } catch (error) {
    console.error('Error al filtrar pedidos por fecha:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Error al filtrar pedidos por fecha',
      error: error.message
    });
  }
});

// Iniciar el servidor
app.listen(PORT, async () => {
  console.log(`🚀 Servidor iniciado en http://localhost:${PORT}`);
  
  // Verificar la conexión a la base de datos al iniciar
  await testConnection();
  
  // Cerrar el proceso si no se puede conectar a la base de datos
  process.on('SIGINT', async () => {
    console.log('Cerrando conexiones a la base de datos...');
    await sql.end();
    process.exit(0);
  });
});

export default app;
