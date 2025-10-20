import sql from '../services/dbSupabase.js'

export const loginPorDni = async (req, res) => {
  let { dni } = req.body;

  if (!dni) {
    return res.status(400).json({
      status: "ERROR",
      message: "Debe ingresar un DNI",
    });
  }

  // Normalizamos: solo dígitos
  dni = String(dni).replace(/\D/g, "");
  if (!dni) {
    return res.status(400).json({ status: "ERROR", message: "DNI inválido" });
  }

  try {
    const rows = await sql`
      SELECT id_cliente, nombre, email, telefono, dni
      FROM clientes
      WHERE dni = ${dni}
      LIMIT 1;
    `;

    if (rows.length === 0) {
      // ❌ NO crear automáticamente
      return res.status(404).json({
        status: "ERROR",
        message: "No existe un cliente con ese DNI",
      });
    }

    // ✅ Existe → devolvemos datos
    return res.json({
      status: "OK",
      message: "Inicio de sesión exitoso",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error en loginPorDni:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Error al iniciar sesión",
      error: error.message,
    });
  }
};
