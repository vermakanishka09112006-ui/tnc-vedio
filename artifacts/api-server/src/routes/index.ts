import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import botRouter from "./bot";
import mobileRouter from "./mobile";
import siteAccessRouter from "./site-access";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/bot", botRouter);
router.use("/mobile", mobileRouter);
router.use(siteAccessRouter);
router.use(proxyRouter);

export default router;
