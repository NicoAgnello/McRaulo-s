// index.js
import express from 'express';
import burgerRoutes from './routes/burguerRoutes.js';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json()); // Para interpretar JSON en el body

// Usar rutas
app.use('/api', burgerRoutes);

// Ruta base
app.get('/', (req, res) => {
  res.send('API PP1-BURGER funcionando!');
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
