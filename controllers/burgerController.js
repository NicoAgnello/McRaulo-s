// controllers/burger.controller.js
import supabase from '../services/dbSupabase.js';

export const getProducts = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('productos')
      .select('*');

    if (error) {
      return res.status(500).json({ error: 'Error al obtener productos' });
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
};
