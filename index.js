// index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors'
import productRoutes from './routes/productRoutes.js';
import pedidoRoutes from './routes/pedidosRoutes.js'
import ingredienteRoutes from './routes/ingredientesRoutes.js'
import categoriaRoutes from './routes/categoriaRoutes.js'


const app = express();
const PORT = process.env.PORT || 3000;
// Middlewares
app.use(cors())
app.use(express.json()); // Para interpretar JSON en el body

// Usar rutas
app.use('/api', productRoutes);
app.use('/api/pedidos', pedidoRoutes)
app.use('/api/ingredientes', ingredienteRoutes)
app.use('/api/categorias', categoriaRoutes)
// Ruta base
app.get('/', (req, res) => {
  res.send('API PP1-BURGER funcionando!');
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});