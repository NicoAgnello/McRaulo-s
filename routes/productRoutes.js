import express from 'express';
import {
  getProducts,
  getProductById,
  getRecetaDeProducto,
  createProduct,
  updateProduct,
  deleteProduct,
  calcularPrecioPersonalizado,
  getProductosPorCategoria  
} from '../controllers/productController.js';

const router = express.Router();

// CRUD de productos
router.get('/productos', getProducts);
router.get('/productos/:id', getProductById);
router.post('/productos', createProduct);
router.put('/productos/:id', updateProduct);
router.delete('/productos/:id', deleteProduct);
// Productos por categoría (usando id_categoria)
router.get('/productos/categoria/:id_categoria', getProductosPorCategoria);

// Calcular precio personalizado
router.post('/productos/:id/calcular-precio', calcularPrecioPersonalizado);

//Receta de producto
router.get('/productos/:id/receta', getRecetaDeProducto);

export default router;
