import { Router } from 'express'
import { validarCupon, listarCuponesDisponibles } from '../controllers/cuponController.js'

const router = Router()
router.post('/validar', validarCupon)
router.get('/disponibles', listarCuponesDisponibles)
export default router
