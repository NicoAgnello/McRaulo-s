// routes/burger.routes.js
import express from 'express';
import { getProducts } from '../controllers/burgerController.js';

const router = express.Router();

router.get('/productos', getProducts);

// Podés agregar POST, PUT, DELETE más adelante:
// router.post('/productos', createBurger);
// router.put('/productos/:id', updateBurger);
// router.delete('/productos/:id', deleteBurger);

export default router;
