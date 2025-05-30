// routes/ingredienteRoutes.js
import { Router } from 'express'
import { getAllIngredientes, getIngredienteById } from '../controllers/ingredientesController.js'

const router = Router()

router.get('/', getAllIngredientes)
router.get('/:id', getIngredienteById)

export default router