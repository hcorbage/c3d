import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import stlRouter from "./stl.js";
import authRouter from "./auth.js";
import creditsRouter from "./credits.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stlRouter);
router.use(authRouter);
router.use(creditsRouter);

export default router;
