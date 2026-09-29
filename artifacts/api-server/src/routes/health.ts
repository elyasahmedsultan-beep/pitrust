import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { querySupabaseKeepAlive } from "../lib/supabaseKeepAlive";
import { supabaseRequest } from "../lib/supabase";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/keep-alive", async (_req, res) => {
  const checkedAt = new Date().toISOString();

  try {
    await querySupabaseKeepAlive(supabaseRequest);
    logger.info({ checkedAt }, "Supabase keep-alive check succeeded");
    res.json({ status: "alive" });
  } catch (error) {
    logger.warn(
      {
        checkedAt,
        errorType: error instanceof Error ? error.name : "unknown",
      },
      "Supabase keep-alive check failed",
    );
    res.status(503).json({ status: "unavailable" });
  }
});

export default router;
