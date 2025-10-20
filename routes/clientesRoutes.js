import express from "express";
const router = express.Router();
import { loginPorDni } from "../controllers/clientesController.js";

router.post("/login-dni", loginPorDni);

export default router;
