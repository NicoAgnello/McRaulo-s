// index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors'
import productRoutes from './routes/productRoutes.js';

const app = express();
const PORT = process.env.PORT || 3000;
// Middlewares
app.use(cors())
app.use(express.json()); // Para interpretar JSON en el body

// Usar rutas
app.use('/api', productRoutes);

// Ruta base
app.get('/', (req, res) => {
  res.send('API PP1-BURGER funcionando!');
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});