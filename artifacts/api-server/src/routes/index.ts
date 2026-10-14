import { Router, type IRouter } from "express";
import healthRouter from "./health";
import glowrideRouter from "./glowride";

const router: IRouter = Router();

router.use(healthRouter);
router.use(glowrideRouter);

export default router;
