// controllers/cuponController.js
import sql from '../services/dbSupabase.js'
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * POST /api/cupon/validar
 * body: { code: string, total: number, id_cliente?: number }
 */
export const validarCupon = async (req, res) => {
  try {
    const { code, total, id_cliente } = req.body;
    if (!code || total == null) {
      return res.status(400).json({ status: 'ERROR', message: 'Faltan code y/o total' });
    }

    const [c] = await sql/*sql*/`
      SELECT * FROM cupon
      WHERE UPPER(codigo) = UPPER(${code})
      LIMIT 1;
    `;
    if (!c) return res.status(400).json({ status: 'ERROR', message: 'Cupón inexistente' });

    // Vencimiento (comparamos con CURRENT_DATE en SQL)
    const okVenc = (await sql`SELECT (CURRENT_DATE <= ${c.fecha_vencimiento}) AS ok`)[0]?.ok === true;
    if (!okVenc) return res.status(400).json({ status: 'ERROR', message: 'Cupón vencido' });

    // Usos disponibles
    if (Number(c.usos_disponibles) <= 0)
      return res.status(400).json({ status: 'ERROR', message: 'No quedan usos disponibles' });

    // Restricción por cliente (si corresponde)
    if (c.id_cliente && Number(id_cliente) !== Number(c.id_cliente)) {
      return res.status(403).json({ status: 'ERROR', message: 'Cupón no válido para este cliente' });
    }

    const cartTotal = Number(total);
    const tipo = String(c.tipo_descuento || '').toLowerCase(); // 'porcentaje' | 'fijo' | 'monto'
    let discount = 0;

    if (tipo === 'porcentaje') {
      discount = round2(cartTotal * (Number(c.descuento) / 100));
    } else if (tipo === 'fijo' || tipo === 'monto') {
      discount = round2(Number(c.descuento));
    } else {
      return res.status(400).json({ status: 'ERROR', message: 'Tipo de descuento inválido' });
    }

    if (discount < 0) discount = 0;
    if (discount > cartTotal) discount = cartTotal;

    return res.json({
      status: 'OK',
      data: {
        id_cupon: c.id_cupon,
        code: c.codigo,
        tipo, // 'porcentaje' | 'fijo'
        value: Number(c.descuento),
        discount,
        total_with_discount: round2(cartTotal - discount),
        vence: c.fecha_vencimiento,
        usos_disponibles: c.usos_disponibles
      }
    });
  } catch (e) {
    return res.status(500).json({ status: 'ERROR', message: 'Error validando cupón', error: e.message });
  }
};

export const listarCuponesDisponibles = async (req, res) => {
  try {
    const { cliente } = req.query;

    let rows;
    if (cliente) {
      rows = await sql/*sql*/`
        SELECT id_cupon, codigo, tipo_descuento, descuento, fecha_vencimiento, usos_disponibles, id_cliente
        FROM cupon
        WHERE (id_cliente = ${cliente} OR id_cliente IS NULL)
          AND usos_disponibles > 0
          AND fecha_vencimiento >= CURRENT_DATE
        ORDER BY (id_cliente IS NULL), fecha_vencimiento, codigo;
      `;
    } else {
      rows = await sql/*sql*/`
        SELECT id_cupon, codigo, tipo_descuento, descuento, fecha_vencimiento, usos_disponibles, id_cliente
        FROM cupon
        WHERE id_cliente IS NULL
          AND usos_disponibles > 0
          AND fecha_vencimiento >= CURRENT_DATE
        ORDER BY fecha_vencimiento, codigo;
      `;
    }

    return res.json({ status: 'OK', data: rows });
  } catch (e) {
    return res.status(500).json({ status: 'ERROR', message: 'Error listando cupones', error: e.message });
  }
};