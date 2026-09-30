import express, { type Express } from "express";
import type { ErrorRequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import { isPiMainnetHost } from "./lib/piHostPolicy";
import { configuredPiNetwork } from "./lib/piA2uConfig.ts";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import {
  attachPiAccessTokenUser,
  attachPiAppSessionUser,
  attachPiIframeSessionUser,
} from "./lib/session";
import { shouldInvokeClerkMiddleware } from "./lib/sessionIdentity.ts";
import { requireSameOrigin } from "./lib/adminPasswordAuth";

const app: Express = express();
const clerkAuthMiddleware = clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(
    getClerkProxyHost(req) ?? "",
    process.env.CLERK_PUBLISHABLE_KEY,
  ),
}));

// Trust only the immediate ingress hop so rate limiting can use the client
// address forwarded by the Replit edge without trusting arbitrary proxy chains.
app.set("trust proxy", 1);

const rateLimitHandler = (_req: express.Request, res: express.Response) => {
  res.status(429).json({ error: "Too many requests. Please try again later." });
};
const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const keepAliveRateLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const signInRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const adminLoginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const sensitiveActionRateLimit = rateLimit({
  windowMs: 5 * 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const aiActionRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const publicChatMessageRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const publicChatTranslationRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0].replace(
            /(\/v1\/client\/sessions\/)[^/]+/,
            "$1[REDACTED]",
          ),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 100 }));

app.use("/api", (req, res, next) => {
  // Clerk's own Frontend API proxy is not part of the application API quota.
  if (req.path.startsWith("/__clerk/") || req.path === "/__clerk") {
    next();
    return;
  }
  apiRateLimit(req, res, next);
});
app.use("/api", (req, res, next) => {
  if (
    configuredPiNetwork() === "mainnet" &&
    !isPiMainnetHost(req.hostname) &&
    !(req.method === "GET" && req.path === "/healthz")
  ) {
    res.status(404).json({ error: "The Pi Mainnet service is only available on the official PiTrust domain" });
    return;
  }
  next();
});
app.use("/api/keep-alive", keepAliveRateLimit);
app.use("/api", attachPiIframeSessionUser);
app.use("/api", attachPiAppSessionUser);
app.use("/api", attachPiAccessTokenUser);
app.use("/api/pi/authenticate", signInRateLimit);
app.use("/api/pi/link", signInRateLimit);
app.use("/api/pi/iframe-session", signInRateLimit);
app.post("/api/pi/session", signInRateLimit);
app.post("/api/admin/session", adminLoginRateLimit);
app.use("/api/pi/payments", sensitiveActionRateLimit);
app.use("/api/contracts/:id/payment", sensitiveActionRateLimit);
app.use("/api/contracts/:id/dispute-fee", sensitiveActionRateLimit);
app.use("/api/contracts/:id/release", sensitiveActionRateLimit);
app.use("/api/admin/disputes/:id/analyze", aiActionRateLimit);
app.use("/api/admin/disputes/:id/decide", sensitiveActionRateLimit);
app.use("/api/admin/payouts/reconcile", sensitiveActionRateLimit);
app.post("/api/chat/rooms/:roomId/messages", publicChatMessageRateLimit);
app.get("/api/chat/messages", publicChatTranslationRateLimit);
app.use("/api", (req, res, next) => {
  const originalPath = req.originalUrl.split("?")[0] || req.path;
  const apiPath = originalPath.replace(/^\/api(?=\/|$)/, "") || "/";
  const hasPiSession = Boolean(
    req.piAppSessionUserId || req.piIframeSessionUserId || req.piAccessTokenUserId,
  );
  if (!shouldInvokeClerkMiddleware(apiPath, hasPiSession)) {
    next();
    return;
  }
  clerkAuthMiddleware(req, res, next);
});
app.use("/api", (req, res, next) => {
  if (
    !req.piAppSessionUserId ||
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS"
  ) {
    next();
    return;
  }
  requireSameOrigin(req, res, next);
});
app.use("/api", router);

const safeErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestError = error as { status?: number; type?: string };
  if (requestError.status === 413) {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  if (requestError.status === 400 && requestError.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is invalid." });
    return;
  }

  req.log.error({ status: requestError.status ?? 500 }, "Unhandled API request error");
  res.status(500).json({ error: "Internal server error." });
};

app.use(safeErrorHandler);

export default app;
