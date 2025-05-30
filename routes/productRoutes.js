
import express from 'express';
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  calcularPrecioPersonalizado,
  getProductosPorCategoria  
} from '../controllers/productController.js'


const router = express.Router();

router.get('/productos', getProducts)
router.get('/productos/:id', getProductById)
router.post('/productos', createProduct)
router.put('/productos/:id', updateProduct)
router.delete('/productos/:id', deleteProduct)

router.get('/categoria/:categoria', getProductosPorCategoria)
router.post('/:id/calcular-precio', calcularPrecioPersonalizado)

export default router;
