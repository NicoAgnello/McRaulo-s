// routes/categoriaRoutes.js
import { Router } from 'express'
import { getCategorias } from '../controllers/categoriasController.js'

const router = Router()
router.get('/', getCategorias)
export default router
