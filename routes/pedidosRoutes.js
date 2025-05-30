import { Router } from 'express'
import {
  getAllPedidos,
  getPedidoById,
  createPedido,
  updateEstadoPedido,
  deletePedido,
  getPedidosByEstado,
  getProductoDetalleEnPedido,
  getEstadisticasPedidos,
  agregarProductosAlPedido,
  filtrarPedidosPorFecha,
  obtenerResumenPedido,
  eliminarProductoDePedido,
  getPedidosPorMetodoPago 
} from '../controllers/pedidosController.js'

const router = Router()

router.get('/', getAllPedidos)
router.get('/:id', getPedidoById)
router.post('/', createPedido)
router.patch('/:id/estado', updateEstadoPedido)
router.delete('/:id', deletePedido)
router.get('/estado/:estado', getPedidosByEstado)
router.get('/:idPedido/productos/:idPedidoProducto', getProductoDetalleEnPedido)
router.get('/estadisticas/resumen', getEstadisticasPedidos)
router.post('/:id/productos', agregarProductosAlPedido)
router.get('/filtro/fecha', filtrarPedidosPorFecha)
router.get('/:id/resumen', obtenerResumenPedido)
router.delete('/:id/productos/:idProducto', eliminarProductoDePedido)
router.get('/metodo-pago/:metodo', getPedidosPorMetodoPago)

export default router
