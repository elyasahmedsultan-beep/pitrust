import { Router, type IRouter } from "express";
import healthRouter from "./health";
import escrowRouter from "./escrow";
import piRouter from "./pi";
import marketplaceRouter from "./marketplace";
import evidenceRouter from "./evidence";
import payoutsRouter from "./payouts";
import adminRouter from "./admin";
import walletRouter from "./wallet";
import publicChatRouter from "./publicChat";
import adminChatRouter from "./adminChat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(piRouter);
router.use(escrowRouter);
router.use(marketplaceRouter);
router.use(evidenceRouter);
router.use(payoutsRouter);
router.use(publicChatRouter);
router.use(adminChatRouter);
router.use(adminRouter);
router.use(walletRouter);

export default router;
