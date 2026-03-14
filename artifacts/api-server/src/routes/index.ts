import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stlRouter from "./stl";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stlRouter);

export default router;
