import { Router } from 'express'
import {
  getAllPedidos,
  getPedidoById,
  createPedido,
  updateEstadoPedido,
  deletePedido,
  cancelarPedido,
  getPedidosByEstado,
  getProductoDetalleEnPedido,
  getProductosAgrupadosEnPedido,
  getEstadisticasPedidos,
  agregarProductosAlPedido,
  filtrarPedidosPorFecha,
  obtenerResumenPedido,
  eliminarProductoDePedido,
  getPedidosPorMetodoPago,
  getPedidosByCliente,
  confirmarPago 
} from '../controllers/pedidosController.js'

const router = Router()

router.get('/', getAllPedidos)
router.get('/:id', getPedidoById)
router.post('/', createPedido)
router.patch('/:id/estado', updateEstadoPedido)
router.delete('/:id', deletePedido)
router.delete('/:id/cancelar', cancelarPedido)
router.get('/estado/:estado', getPedidosByEstado)
router.get('/:idPedido/productos/:idPedidoProducto', getProductoDetalleEnPedido)
router.get('/:idPedido/productos-por-id/:idProducto', getProductosAgrupadosEnPedido); 
router.get('/estadisticas/resumen', getEstadisticasPedidos)
router.post('/:id/productos', agregarProductosAlPedido)
router.get('/filtro/fecha', filtrarPedidosPorFecha)
router.get('/:id/resumen', obtenerResumenPedido)
router.delete('/:id/productos/:idProducto', eliminarProductoDePedido)
router.get('/metodo-pago/:metodo', getPedidosPorMetodoPago)
router.get('/cliente/:idCliente', getPedidosByCliente)
router.post("/:id/confirmar-pago", confirmarPago);

export default router
