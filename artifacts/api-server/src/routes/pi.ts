import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { clerkClient } from "@clerk/express";
import { requireSession, authenticatedUserId, isContractParticipant } from "../lib/session";
import { findContract } from "../lib/escrow";
import {
  expectedDisputeFeeForPayment,
  fixedPiUnits,
  linkedPiUid,
  piRequest,
  piNetworkApiConfigured,
  piNetworkRequest,
  savePaymentLedger,
  verifyIncomingPayment,
  type PiPayment,
} from "../lib/pi";
import {
  ESCROW_SERVICE_DEPOSIT,
  listEscrowServiceDeposits,
  saveEscrowServiceDeposit,
  verifyEscrowServiceDepositPayment,
} from "../lib/escrowServiceDeposit";
import { supabaseRequest } from "../lib/supabase";
import { currentPiNetwork } from "../lib/piA2u";
import { configuredPiApiKey } from "../lib/piA2uConfig.ts";
import { getPaymentFeeSettings } from "../lib/appSettings";
import { isTestnetWalletHostAllowed } from "../lib/testnetWalletAccess";
import {
  createPiIframeSessionCredential,
  isPiIframeSessionAllowed,
  isPiIframeSessionToken,
  PI_IFRAME_SESSION_TTL_SECONDS,
  hashPiIframeSessionToken,
} from "../lib/piIframeSession.ts";
import {
  createPiAppSessionCredential,
  hashPiAppSessionToken,
  parsePiAppSessionCookie,
  piAppSessionSetCookie,
  PI_APP_SESSION_TTL_SECONDS,
} from "../lib/piAppSession.ts";
import { resolvePiAppIdentityAccount } from "../lib/piAppIdentity.ts";
import {
  linkPiIdentity,
  piReservedEmailAddressForUid,
  resolvePiIdentityAccount,
  type PiIdentityDependencies,
} from "../lib/piIdentity.ts";
import {
  CreateContractPaymentIntentParams,
  CreateContractPaymentIntentResponse,
  CreateDisputeFeeIntentParams,
  CreateDisputeFeeIntentResponse,
  LinkPiAccountBody,
  LinkPiAccountResponse,
  AuthenticatePiBody,
  AuthenticatePiResponse,
  GetPiStatusResponse,
  CreateMonthlyBadgePaymentIntentResponse,
  GetMonthlyBadgeStatusResponse,
  CreateEscrowServiceDepositIntentResponse,
  ListEscrowServiceDepositsResponse,
  ApprovePiPaymentBody,
  ApprovePiPaymentResponse,
  CompletePiPaymentBody,
  CompletePiPaymentResponse,
  CreatePiIframeSessionBody,
  CreatePiIframeSessionResponse,
  GetPiIframeIdentityResponse,
  CreatePiSessionBody,
  CreatePiSessionResponse,
  GetPiSessionResponse,
  DeletePiSessionResponse,
} from "@workspace/api-zod";
import {
  verifyPiAccessTokenWithAppStudio,
  type VerifiedPiIdentity,
} from "../lib/piAppStudioAuth.ts";

const router: IRouter = Router();

function errorStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: number }).status)
    : 502;
}

async function verifyPiIdentity(accessToken: string): Promise<VerifiedPiIdentity> {
  return verifyPiAccessTokenWithAppStudio(accessToken);
}

async function clerkUserForPi(
  piUid: string,
  displayName: string,
): Promise<{ userId: string; created: boolean }> {
  const externalId = `pactline:pi:${piUid}`;
  const existing = await clerkClient.users.getUserList({ externalId: [externalId], limit: 1 });
  if (existing.data[0]) return { userId: existing.data[0].id, created: false };

  try {
    const user = await clerkClient.users.createUser({
      externalId,
      emailAddress: [piReservedEmailAddressForUid(piUid)],
      emailAddressIdentificationStatus: ["reserved"],
      firstName: displayName || "Pi Member",
      skipPasswordRequirement: true,
    });
    return { userId: user.id, created: true };
  } catch (error) {
    // A simultaneous first login may have created the same Clerk identity.
    const raced = await clerkClient.users.getUserList({ externalId: [externalId], limit: 1 });
    if (raced.data[0]) return { userId: raced.data[0].id, created: false };
    throw error;
  }
}

const piIdentityDependencies: PiIdentityDependencies = {
  findOwnerByPiUid: async (piUid) => {
    const rows = await supabaseRequest<Array<{ user_id: string }>>(
      `escrow_profiles?pi_uid=eq.${encodeURIComponent(piUid)}&select=user_id&limit=1`,
    );
    return rows[0]?.user_id ?? null;
  },
  findPiUidByUser: async (userId) => {
    const rows = await supabaseRequest<Array<{ pi_uid: string | null }>>(
      `escrow_profiles?user_id=eq.${encodeURIComponent(userId)}&select=pi_uid&limit=1`,
    );
    return rows.length ? rows[0].pi_uid : undefined;
  },
  createClerkUserForPi: clerkUserForPi,
  createProfile: async (userId, displayName, piUid) => {
    await supabaseRequest("escrow_profiles", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        display_name: displayName,
        referral_code: randomUUID().replaceAll("-", "").slice(0, 12),
        ...(piUid ? { pi_uid: piUid } : {}),
      }),
    });
  },
  claimPiUid: async (userId, piUid) => {
    const rows = await supabaseRequest<Array<{ pi_uid: string }>>(
      `escrow_profiles?user_id=eq.${encodeURIComponent(userId)}&pi_uid=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ pi_uid: piUid }),
      },
    );
    return rows.length > 0;
  },
};

async function resolvePiAccount(
  identity: VerifiedPiIdentity,
  createIfMissing: boolean,
): Promise<{ userId: string; createdClerkUserId?: string }> {
  return resolvePiIdentityAccount(identity, createIfMissing, piIdentityDependencies);
}

router.post("/pi/authenticate", async (req, res): Promise<void> => {
  const body = AuthenticatePiBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const identity = await verifyPiIdentity(body.data.accessToken);
    const account = await resolvePiAccount(identity, body.data.intent === "sign-up");
    if (account.createdClerkUserId) {
      try {
        await clerkClient.users.deleteUser(account.createdClerkUserId);
      } catch (error) {
        req.log.error({ err: error }, "Could not remove an unlinked Pi Clerk account");
      }
    }
    const signInToken = await clerkClient.signInTokens.createSignInToken({
      userId: account.userId,
      expiresInSeconds: 180,
    });
    res.json(AuthenticatePiResponse.parse({ ticket: signInToken.token }));
  } catch (error) {
    const status = errorStatus(error);
    if (status === 401 || status === 404 || status === 409) {
      req.log.warn({ status }, "Pi sign-in request was denied");
    } else {
      req.log.error({ err: error }, "Pi sign-in failed");
    }
    if (status === 401 || status === 404 || status === 409 || status === 503) {
      res.status(status).json({
        error: status === 401
          ? "Pi access token was rejected"
          : status === 404
            ? "No Pactline account is linked to this Pi identity"
          : status === 409
            ? "This Pi identity is already linked to a different Pactline account"
            : "Pi sign-in is temporarily unavailable",
      });
      return;
    }
    res.status(502).json({ error: "Pi sign-in could not be completed" });
  }
});

function piAppSessionSecure(req: Request): boolean {
  return req.secure || req.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() === "https";
}

router.post("/pi/session", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, private");
  const body = CreatePiSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const identity = await verifyPiIdentity(body.data.accessToken);
    const account = await resolvePiAppIdentityAccount(
      identity,
      body.data.intent === "sign-up",
      {
        findOwnerByPiUid: piIdentityDependencies.findOwnerByPiUid,
        createProfile: piIdentityDependencies.createProfile,
        createAccountId: () => `pi_${randomUUID()}`,
        errorStatus,
      },
    );
    const credential = createPiAppSessionCredential();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PI_APP_SESSION_TTL_SECONDS * 1000).toISOString();
    const piUsername = identity.username ?? null;
    await supabaseRequest(
      `pi_app_sessions?expires_at=lte.${encodeURIComponent(now.toISOString())}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );
    await supabaseRequest("pi_app_sessions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        token_hash: credential.tokenHash,
        pi_uid: identity.uid,
        pi_username: piUsername,
        created_at: now.toISOString(),
        expires_at: expiresAt,
      }),
    });
    res.set("Set-Cookie", piAppSessionSetCookie(credential.token, piAppSessionSecure(req)));
    res.json(CreatePiSessionResponse.parse({
      authenticated: true,
      accountId: account.userId,
      piUid: identity.uid,
      username: piUsername,
    }));
  } catch (error) {
    const status = errorStatus(error);
    if ([401, 404, 409].includes(status)) {
      res.status(status).json({
        error: status === 401
          ? "Pi access token was rejected"
          : status === 404
            ? "No Pactline account is linked to this Pi identity"
            : "This Pi identity is already linked to a different Pactline account",
      });
      return;
    }
    req.log.error({ status, errorName: error instanceof Error ? error.name : typeof error }, "Could not create Pi app session");
    res.status(503).json({ error: "Pi app session service is temporarily unavailable" });
  }
});

router.get("/pi/session", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, private");
  const session = req.piAppSessionUserId && req.piAppSessionPiUid
    ? {
        authenticated: true as const,
        accountId: req.piAppSessionUserId,
        piUid: req.piAppSessionPiUid,
        username: req.piAppSessionUsername ?? null,
      }
    : { authenticated: false as const };
  res.json(GetPiSessionResponse.parse(session));
});

router.delete("/pi/session", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, private");
  const token = parsePiAppSessionCookie(req.get("cookie"));
  res.set("Set-Cookie", piAppSessionSetCookie("", piAppSessionSecure(req), 0));
  try {
    if (token) {
      await supabaseRequest(
        `pi_app_sessions?token_hash=eq.${hashPiAppSessionToken(token)}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
    }
    res.json(DeletePiSessionResponse.parse({ ok: true }));
  } catch (error) {
    req.log.error({ status: errorStatus(error), errorName: error instanceof Error ? error.name : typeof error }, "Could not revoke Pi app session");
    res.status(503).json({ error: "Pi app session could not be revoked" });
  }
});

router.post("/pi/iframe-session", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, private");
  if (!isPiIframeSessionAllowed(req.hostname)) {
    res.status(404).json({ error: "Pi iframe identity sessions are unavailable" });
    return;
  }

  const body = CreatePiIframeSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A valid Pi access token is required" });
    return;
  }

  try {
    const identity = await verifyPiIdentity(body.data.accessToken);
    const account = await resolvePiAccount(identity, body.data.intent === "sign-up");
    if (account.createdClerkUserId) {
      try {
        await clerkClient.users.deleteUser(account.createdClerkUserId);
      } catch (error) {
        req.log.error({ err: error }, "Could not remove an unlinked Pi Clerk account");
      }
    }
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + PI_IFRAME_SESSION_TTL_SECONDS * 1000,
    ).toISOString();
    const credential = createPiIframeSessionCredential();

    await supabaseRequest(
      `pi_iframe_sessions?expires_at=lte.${encodeURIComponent(createdAt)}`,
      {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      },
    );
    await supabaseRequest("pi_iframe_sessions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        token_hash: credential.tokenHash,
        pi_uid: identity.uid,
        pi_username: identity.username,
        created_at: createdAt,
        expires_at: expiresAt,
      }),
    });

    res.json(CreatePiIframeSessionResponse.parse({
      sessionToken: credential.token,
      expiresAt,
    }));
  } catch (error) {
    const status = errorStatus(error);
    if (status === 401) {
      res.status(401).json({ error: "Pi access token was rejected" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: "No Pactline account is linked to this Pi identity" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: "This Pi identity is already linked to a different Pactline account" });
      return;
    }
    req.log.error(
      {
        status,
        errorName: error instanceof Error ? error.name : typeof error,
      },
      "Could not create Pi iframe identity session",
    );
    res.status(503).json({ error: "Pi iframe identity sessions are temporarily unavailable" });
  }
});

router.get("/pi/iframe-session/identity", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, private");
  if (!isPiIframeSessionAllowed(req.hostname)) {
    res.status(404).json({ error: "Pi iframe identity sessions are unavailable" });
    return;
  }

  const authorization = req.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization);
  const token = match?.[1];
  if (!token || !isPiIframeSessionToken(token)) {
    res.status(401).json({ error: "A valid Pi iframe session is required" });
    return;
  }

  try {
    const now = new Date().toISOString();
    await supabaseRequest(
      `pi_iframe_sessions?expires_at=lte.${encodeURIComponent(now)}`,
      {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      },
    );
    const rows = await supabaseRequest<Array<{
      pi_uid: string;
      pi_username: string | null;
    }>>(
      `pi_iframe_sessions?token_hash=eq.${hashPiIframeSessionToken(token)}` +
        `&expires_at=gt.${encodeURIComponent(now)}&select=pi_uid,pi_username&limit=1`,
    );
    const identity = rows[0];
    const accountId = req.piIframeSessionUserId;
    if (!identity || !accountId) {
      res.status(401).json({ error: "Pi iframe session is invalid or expired" });
      return;
    }

    res.json(GetPiIframeIdentityResponse.parse({
      uid: identity.pi_uid,
      username: identity.pi_username,
      accountId,
    }));
  } catch (error) {
    req.log.error(
      {
        status: errorStatus(error),
        errorName: error instanceof Error ? error.name : typeof error,
      },
      "Could not verify Pi iframe identity session",
    );
    res.status(503).json({ error: "Pi iframe identity is temporarily unavailable" });
  }
});

router.delete("/pi/iframe-session", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, private");
  if (!isPiIframeSessionAllowed(req.hostname)) {
    res.status(404).json({ error: "Pi iframe app sessions are unavailable" });
    return;
  }
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.get("authorization") ?? "");
  const token = match?.[1];
  if (!token || !req.piIframeSessionUserId) {
    res.status(401).json({ error: "A valid Pi iframe app session is required" });
    return;
  }
  try {
    await supabaseRequest(
      `pi_iframe_sessions?token_hash=eq.${hashPiIframeSessionToken(token)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );
    res.sendStatus(204);
  } catch (error) {
    req.log.error(
      { status: errorStatus(error), errorName: error instanceof Error ? error.name : typeof error },
      "Could not revoke Pi iframe app session",
    );
    res.status(503).json({ error: "Pi iframe app session could not be revoked" });
  }
});

router.use("/pi", requireSession);

router.get("/pi/status", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req)!;
  try {
    res.json(GetPiStatusResponse.parse({ linked: (await linkedPiUid(userId)) !== null }));
  } catch (error) {
    req.log.error({ err: error }, "Could not read Pi identity status");
    res.status(errorStatus(error)).json({ error: "Pi identity status is unavailable" });
  }
});

router.post("/pi/link", async (req, res): Promise<void> => {
  const body = LinkPiAccountBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const clerkUserId = authenticatedUserId(req)!;
  try {
    const identity = await verifyPiIdentity(body.data.accessToken);
    await linkPiIdentity(clerkUserId, identity.uid, piIdentityDependencies);
    res.json(LinkPiAccountResponse.parse({ linked: true }));
  } catch (error) {
    req.log.error({ err: error }, "Pi identity linking failed");
    if (errorStatus(error) === 409) {
      res.status(409).json({ error: "This Pi UID is already bound to another account" });
      return;
    }
    res.status(errorStatus(error)).json({ error: "Pi identity could not be linked" });
  }
});

router.get("/pi/escrow-service-deposits", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req)!;
  try {
    const deposits = await listEscrowServiceDeposits(userId);
    res.json(ListEscrowServiceDepositsResponse.parse(deposits));
  } catch (error) {
    req.log.error({ err: error }, "Could not list escrow service deposits");
    res.status(errorStatus(error)).json({ error: "Escrow service deposits are unavailable" });
  }
});

router.post("/pi/escrow-service-deposits/intent", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(req)!;
  if (currentPiNetwork() !== "Pi Network") {
    res.status(409).json({ error: "Escrow service deposits are available on Pi Mainnet only" });
    return;
  }
  if (!piNetworkApiConfigured()) {
    res.status(503).json({ error: "PI_NETWORK_API_KEY is not configured; no payment intent was issued" });
    return;
  }
  try {
    if (!await linkedPiUid(userId)) {
      res.status(409).json({ error: "Link a verified Pi account before buying this deposit" });
      return;
    }
    // Fail closed when the additive payment-ledger migration has not been applied.
    await listEscrowServiceDeposits(userId);
    res.json(CreateEscrowServiceDepositIntentResponse.parse(ESCROW_SERVICE_DEPOSIT));
  } catch (error) {
    req.log.error({ err: error }, "Could not create escrow service deposit intent");
    res.status(errorStatus(error)).json({ error: "Escrow service deposit checkout is unavailable" });
  }
});

async function contractForPayment(payment: PiPayment) {
  const contractId = payment.metadata?.contractId;
  if (typeof contractId !== "string") return null;
  return findContract(contractId);
}

async function hasConfirmedContractFunding(contractId: string, buyerId: string): Promise<boolean> {
  const rows = await supabaseRequest<Array<{ id: string }>>(
    `escrow_payment_ledger?contract_id=eq.${encodeURIComponent(contractId)}&user_id=eq.${encodeURIComponent(buyerId)}&status=eq.confirmed&fee_type=is.null&select=id&limit=1`,
  );
  return rows.length > 0;
}

type MonthlyBadgeAudit = {
  intent_id: string;
  user_id: string;
  billing_month: string;
  pi_uid: string;
  network: string;
  payment_id: string | null;
  amount: number | string;
  status: string;
  txid: string | null;
};

async function verifyMonthlyBadgePayment(
  paymentId: string,
  payment: PiPayment,
  clerkUserId: string,
  expectedPiUid: string,
): Promise<MonthlyBadgeAudit> {
  const metadata = payment.metadata;
  const auditId = metadata?.badgeAuditId;
  if (typeof auditId !== "string") {
    throw Object.assign(new Error("Monthly badge audit metadata is missing"), { status: 400 });
  }
  const rows = await supabaseRequest<MonthlyBadgeAudit[]>(
    `escrow_monthly_badge_audits?intent_id=eq.${encodeURIComponent(auditId)}&user_id=eq.${encodeURIComponent(clerkUserId)}&select=*&limit=1`,
  );
  const audit = rows[0];
  const network = currentPiNetwork();
  if (
    !audit ||
    !network ||
    audit.pi_uid !== expectedPiUid ||
    audit.network !== network ||
    metadata?.billingMonth !== audit.billing_month ||
    payment.identifier !== paymentId ||
    (audit.payment_id !== null && audit.payment_id !== paymentId) ||
    fixedPiUnits(payment.amount ?? "") !== fixedPiUnits("2") ||
    fixedPiUnits(audit.amount) !== fixedPiUnits("2") ||
    payment.direction !== "user_to_app" ||
    payment.network !== network ||
    payment.user_uid !== expectedPiUid ||
    metadata?.contractId != null ||
    metadata?.feeType != null ||
    payment.status?.cancelled ||
    payment.status?.user_cancelled
  ) {
    throw Object.assign(new Error("Pi payment does not match the pending monthly badge audit"), { status: 400 });
  }
  return audit;
}

async function saveMonthlyBadgePayment(
  audit: MonthlyBadgeAudit,
  clerkUserId: string,
  paymentId: string,
  status: "pending" | "confirmed",
  txid?: string,
): Promise<void> {
  const rows = await supabaseRequest<Array<{ status: string }>>("rpc/record_monthly_badge_payment", {
    method: "POST",
    body: JSON.stringify({
      p_intent_id: audit.intent_id,
      p_user_id: clerkUserId,
      p_payment_id: paymentId,
      p_status: status,
      p_txid: txid ?? null,
    }),
  });
  if (!rows[0] || (status === "confirmed" && rows[0].status !== "confirmed")) {
    throw new Error("Monthly badge audit did not persist the expected Pi payment state");
  }
}

router.post("/badges/monthly/intent", async (req, res): Promise<void> => {
  const clerkUserId = authenticatedUserId(req)!;
  try {
    const piUid = await linkedPiUid(clerkUserId);
    const network = currentPiNetwork();
    if (!piUid || !network) {
      res.status(409).json({ error: "Link a verified Pi account and configure a valid Pi network first" });
      return;
    }
    if (!configuredPiApiKey()) {
      res.status(503).json({ error: "Pi Platform API credentials for the selected network are not configured; no badge payment intent was issued" });
      return;
    }
    const billingMonth = `${new Date().toISOString().slice(0, 7)}-01`;
    const audits = await supabaseRequest<Array<{
      intent_id: string;
      status: string;
      payment_id: string | null;
      amount: number | string;
      billing_month: string;
    }>>("rpc/reserve_monthly_badge_audit", {
      method: "POST",
      body: JSON.stringify({
        p_intent_id: randomUUID(),
        p_user_id: clerkUserId,
        p_pi_uid: piUid,
        p_network: network,
        p_billing_month: billingMonth,
      }),
    });
    const audit = audits[0];
    if (!audit) throw new Error("Monthly badge audit could not be reserved");
    if (audit.status === "confirmed") {
      res.status(409).json({ error: "The monthly badge is already confirmed for this billing month" });
      return;
    }
    if (audit.status !== "pending") {
      res.status(409).json({ error: "The monthly badge audit requires moderator reconciliation" });
      return;
    }
    if (audit.payment_id) {
      res.status(409).json({
        error: "A Pi payment is already bound to this monthly audit; do not create another payment. Resume or reconcile the existing payment.",
      });
      return;
    }
    res.json(CreateMonthlyBadgePaymentIntentResponse.parse({
      intentId: audit.intent_id,
      amount: Number(audit.amount),
      memo: `Monthly badge audit ${audit.billing_month}`,
      metadata: { badgeAuditId: audit.intent_id, billingMonth: audit.billing_month },
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not reserve monthly badge audit");
    res.status(errorStatus(error)).json({ error: "Could not reserve monthly badge audit" });
  }
});

router.get("/badges/monthly", async (req, res): Promise<void> => {
  const clerkUserId = authenticatedUserId(req)!;
  const billingMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  try {
    const rows = await supabaseRequest<Array<{ status: string }>>(
      `escrow_monthly_badge_audits?user_id=eq.${encodeURIComponent(clerkUserId)}&billing_month=eq.${billingMonth}&select=status&limit=1`,
    );
    const status = rows[0]?.status ?? null;
    res.json(GetMonthlyBadgeStatusResponse.parse({
      billingMonth,
      status,
      confirmed: status === "confirmed",
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not load monthly badge audit");
    res.status(errorStatus(error)).json({ error: "Monthly badge status is unavailable" });
  }
});

router.post("/contracts/:id/payment", async (req, res): Promise<void> => {
  if (isTestnetWalletHostAllowed(req.hostname)) {
    res.status(409).json({
      error: "Testnet escrow funding uses the internal wallet; no Pi payment intent was issued",
    });
    return;
  }
  const params = CreateContractPaymentIntentParams.safeParse({ id: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const contract = await findContract(params.data.id);
    const actor = authenticatedUserId(req)!;
    if (!contract || contract.buyer_id !== actor) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    if (contract.status !== "awaiting_funding") {
      res.status(409).json({ error: "Contract is not accepting a new payment" });
      return;
    }
    if (contract.currency.toUpperCase() !== "PI") {
      res.status(409).json({ error: "Only PI-denominated contracts can use direct Pi funding; no FX conversion was applied" });
      return;
    }
    const feeSettings = await getPaymentFeeSettings();
    const units = fixedPiUnits(contract.amount);
    if (units === null || fixedPiUnits(Number(contract.amount)) !== units) {
      res.status(409).json({ error: "Contract amount cannot be safely represented by the Pi SDK" });
      return;
    }
    if (!configuredPiApiKey()) {
      res.status(503).json({ error: "Pi Platform API credentials for the selected network are not configured; no payment intent was issued" });
      return;
    }
    if (!await linkedPiUid(actor)) {
      res.status(409).json({ error: "Link a verified Pi account before funding" });
      return;
    }
    res.json(CreateContractPaymentIntentResponse.parse({
      contractId: contract.id,
      amount: Number(contract.amount),
      transactionFeePercentage: feeSettings.transactionFeePercentage,
      memo: `Escrow funding ${contract.reference}`,
      metadata: { contractId: contract.id },
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not create Pi payment intent");
    res.status(errorStatus(error)).json({ error: "Could not create Pi payment intent" });
  }
});

router.post("/contracts/:id/dispute-fee", async (req, res): Promise<void> => {
  const params = CreateDisputeFeeIntentParams.safeParse({ id: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const contract = await findContract(params.data.id);
    const actor = authenticatedUserId(req)!;
    if (!contract || !isContractParticipant(contract, actor)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    if (!["funded", "in_delivery"].includes(contract.status)) {
      res.status(409).json({ error: "The contract must have confirmed funding before a dispute fee can be paid" });
      return;
    }
    if (!await hasConfirmedContractFunding(contract.id, contract.buyer_id ?? "")) {
      res.status(409).json({ error: "A confirmed Pi contract payment is required before a dispute fee" });
      return;
    }
    if (!configuredPiApiKey()) {
      res.status(503).json({ error: "Pi Platform API credentials for the selected network are not configured; no dispute-fee intent was issued" });
      return;
    }
    const feeSettings = await getPaymentFeeSettings();
    if (!await linkedPiUid(actor)) {
      res.status(409).json({ error: "Link a verified Pi account before paying dispute fees" });
      return;
    }
    const [prior] = await supabaseRequest<Array<{ id: string }>>(
      `escrow_payment_ledger?contract_id=eq.${encodeURIComponent(contract.id)}&user_id=eq.${encodeURIComponent(actor)}&fee_type=eq.dispute&status=eq.fee_confirmed&consumed_at=is.null&select=id&limit=1`,
    );
    if (prior) {
      res.status(409).json({ error: "A confirmed dispute fee already exists for this participant and contract" });
      return;
    }
    res.json(CreateDisputeFeeIntentResponse.parse({
      contractId: contract.id,
      amount: feeSettings.disputeResolutionFeePi,
      memo: `Dispute fee ${contract.reference}`,
      metadata: { contractId: contract.id, feeType: "dispute" },
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not create Pi dispute-fee intent");
    res.status(errorStatus(error)).json({ error: "Could not create Pi dispute-fee intent" });
  }
});

router.post("/pi/payments/approve", async (req, res): Promise<void> => {
  const action = ApprovePiPaymentBody.safeParse(req.body);
  if (!action.success) {
    res.status(400).json({ error: "A valid paymentId is required" });
    return;
  }
  const { paymentId, purpose } = action.data;
  try {
    const fetched = purpose === "escrow_service_deposit"
      ? await piNetworkRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`)
      : await piRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`);
    const userId = authenticatedUserId(req)!;
    const piUid = await linkedPiUid(userId);
    if (!piUid) {
      res.status(409).json({ error: "Link a verified Pi account before processing payments" });
      return;
    }
    if (purpose === "escrow_service_deposit") {
      verifyEscrowServiceDepositPayment(paymentId, fetched, piUid, currentPiNetwork());
      await saveEscrowServiceDeposit({ paymentId, userId, piUid, status: "pending" });
      if (fetched.status?.developer_approved) {
        await saveEscrowServiceDeposit({ paymentId, userId, piUid, status: "approved" });
        res.json(ApprovePiPaymentResponse.parse({ approved: true, idempotent: true }));
        return;
      }
      await piNetworkRequest(`/payments/${encodeURIComponent(paymentId)}/approve`, { method: "POST" });
      const approved = await piNetworkRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`);
      verifyEscrowServiceDepositPayment(paymentId, approved, piUid, currentPiNetwork());
      if (
        !approved.status?.developer_approved ||
        approved.status.cancelled ||
        approved.status.user_cancelled
      ) {
        res.status(409).json({ error: "Pi did not confirm escrow service deposit approval" });
        return;
      }
      await saveEscrowServiceDeposit({ paymentId, userId, piUid, status: "approved" });
      res.json(ApprovePiPaymentResponse.parse({ approved: true }));
      return;
    }
    if (fetched.metadata?.type === ESCROW_SERVICE_DEPOSIT.metadata.type) {
      res.status(400).json({ error: "Escrow service deposits require the matching payment purpose" });
      return;
    }
    if (fetched.metadata?.badgeAuditId != null) {
      const audit = await verifyMonthlyBadgePayment(paymentId, fetched, userId, piUid);
      await saveMonthlyBadgePayment(audit, userId, paymentId, "pending");
      if (fetched.status?.developer_approved) {
        res.json({ approved: true, idempotent: true });
        return;
      }
      await piRequest(`/payments/${encodeURIComponent(paymentId)}/approve`, { method: "POST" });
      const approvedBadgePayment = await piRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`);
      await verifyMonthlyBadgePayment(paymentId, approvedBadgePayment, userId, piUid);
      if (
        !approvedBadgePayment.status?.developer_approved ||
        approvedBadgePayment.status.cancelled ||
        approvedBadgePayment.status.user_cancelled
      ) {
        res.status(409).json({ error: "Pi did not confirm monthly badge payment approval" });
        return;
      }
      res.json({ approved: true });
      return;
    }
    const contract = await contractForPayment(fetched);
    const feeType = fetched.metadata?.feeType === "dispute" ? "dispute" : undefined;
    if (!contract || !isContractParticipant(contract, userId) || (!feeType && contract.buyer_id !== userId)) {
      res.status(404).json({ error: "Payment contract not found" });
      return;
    }
    if (feeType && !["funded", "in_delivery"].includes(contract.status)) {
      res.status(409).json({ error: "Dispute fees require confirmed contract funding" });
      return;
    }
    if (feeType && !await hasConfirmedContractFunding(contract.id, contract.buyer_id ?? "")) {
      res.status(409).json({ error: "A confirmed Pi contract payment is required before a dispute fee" });
      return;
    }
    if (!feeType) await getPaymentFeeSettings();
    const disputeFee = feeType
      ? await expectedDisputeFeeForPayment(paymentId, userId)
      : undefined;
    const payment = await verifyIncomingPayment(paymentId, contract, piUid, feeType, disputeFee);
    if (!feeType && contract.status !== "awaiting_funding" && contract.status !== "funded") {
      res.status(409).json({ error: "Contract is not accepting payment" });
      return;
    }
    if (payment.status?.developer_approved) {
      res.json({ approved: true, idempotent: true });
      return;
    }
    await piRequest(`/payments/${encodeURIComponent(paymentId)}/approve`, { method: "POST" });
    const approved = await verifyIncomingPayment(paymentId, contract, piUid, feeType, disputeFee);
    if (
      !approved.status?.developer_approved ||
      approved.status.cancelled ||
      approved.status.user_cancelled
    ) {
      res.status(409).json({ error: "Pi did not confirm developer approval" });
      return;
    }
    await savePaymentLedger({
      paymentId,
      contractId: contract.id,
      userId,
      status: "approved",
      amount: feeType ? disputeFee! : contract.amount,
      feeType: feeType ?? null,
    });
    res.json({ approved: true });
  } catch (error) {
    req.log.error({ err: error }, "Pi payment approval failed");
    res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Pi payment approval failed" });
  }
});

router.post("/pi/payments/complete", async (req, res): Promise<void> => {
  const completion = CompletePiPaymentBody.safeParse(req.body);
  if (!completion.success) {
    res.status(400).json({ error: "A valid paymentId is required" });
    return;
  }
  const { paymentId, purpose } = completion.data;
  const clientTxid = completion.data.txid;
  try {
    const fetched = purpose === "escrow_service_deposit"
      ? await piNetworkRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`)
      : await piRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`);
    const userId = authenticatedUserId(req)!;
    const piUid = await linkedPiUid(userId);
    if (!piUid) {
      res.status(409).json({ error: "Link a verified Pi account before processing payments" });
      return;
    }
    if (clientTxid && fetched.transaction?.txid && clientTxid !== fetched.transaction.txid) {
      res.status(409).json({ error: "Pi transaction verification did not match txid" });
      return;
    }
    const txid = clientTxid ?? fetched.transaction?.txid ?? undefined;
    if (purpose === "escrow_service_deposit") {
      verifyEscrowServiceDepositPayment(paymentId, fetched, piUid, currentPiNetwork());
      await saveEscrowServiceDeposit({ paymentId, userId, piUid, status: "pending" });
      if (!fetched.status?.developer_approved) {
        res.status(409).json({ error: "Pi has not approved this escrow service deposit" });
        return;
      }
      if (!txid) {
        res.status(409).json({ error: "Pi has not submitted a transaction for this deposit yet" });
        return;
      }
      const alreadyComplete =
        fetched.status?.developer_completed &&
        fetched.status?.transaction_verified &&
        fetched.transaction?.verified &&
        fetched.transaction?.txid === txid;
      if (!alreadyComplete) {
        await piNetworkRequest(`/payments/${encodeURIComponent(paymentId)}/complete`, {
          method: "POST",
          body: JSON.stringify({ txid }),
        });
      }
      const completedDeposit = await piNetworkRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`);
      verifyEscrowServiceDepositPayment(paymentId, completedDeposit, piUid, currentPiNetwork());
      if (
        !completedDeposit.status?.developer_approved ||
        !completedDeposit.status?.transaction_verified ||
        !completedDeposit.transaction?.verified ||
        !completedDeposit.status?.developer_completed ||
        completedDeposit.status.cancelled ||
        completedDeposit.status.user_cancelled ||
        completedDeposit.transaction.txid !== txid
      ) {
        res.status(409).json({ error: "Pi did not confirm every escrow service deposit payment state" });
        return;
      }
      await saveEscrowServiceDeposit({ paymentId, userId, piUid, status: "confirmed", txid });
      res.json(CompletePiPaymentResponse.parse({
        funded: false,
        confirmed: true,
        idempotent: alreadyComplete,
        productName: ESCROW_SERVICE_DEPOSIT.productName,
      }));
      return;
    }
    if (fetched.metadata?.type === ESCROW_SERVICE_DEPOSIT.metadata.type) {
      res.status(400).json({ error: "Escrow service deposits require the matching payment purpose" });
      return;
    }
    if (!txid) {
      res.status(409).json({ error: "Pi has not submitted a transaction for this payment yet" });
      return;
    }
    if (fetched.metadata?.badgeAuditId != null) {
      const audit = await verifyMonthlyBadgePayment(paymentId, fetched, userId, piUid);
      await saveMonthlyBadgePayment(audit, userId, paymentId, "pending");
      const alreadyBadgeComplete =
        fetched.status?.developer_completed &&
        fetched.status?.transaction_verified &&
        fetched.transaction?.verified &&
        fetched.transaction?.txid === txid;
      if (!alreadyBadgeComplete && !fetched.status?.developer_approved) {
        res.status(409).json({ error: "Pi has not approved this monthly badge payment" });
        return;
      }
      if (!alreadyBadgeComplete) {
        await piRequest(`/payments/${encodeURIComponent(paymentId)}/complete`, {
          method: "POST",
          body: JSON.stringify({ txid }),
        });
      }
      const completedBadgePayment = await piRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`);
      await verifyMonthlyBadgePayment(paymentId, completedBadgePayment, userId, piUid);
      if (
        !completedBadgePayment.status?.developer_approved ||
        !completedBadgePayment.status?.transaction_verified ||
        !completedBadgePayment.transaction?.verified ||
        !completedBadgePayment.status?.developer_completed ||
        completedBadgePayment.status.cancelled ||
        completedBadgePayment.status.user_cancelled ||
        completedBadgePayment.transaction.txid !== txid
      ) {
        res.status(409).json({ error: "Pi did not confirm every monthly badge payment state" });
        return;
      }
      await saveMonthlyBadgePayment(audit, userId, paymentId, "confirmed", txid);
      res.json({ confirmed: true, billingMonth: audit.billing_month });
      return;
    }
    const contract = await contractForPayment(fetched);
    const feeType = fetched.metadata?.feeType === "dispute" ? "dispute" : undefined;
    if (!contract || !isContractParticipant(contract, userId) || (!feeType && contract.buyer_id !== userId)) {
      res.status(404).json({ error: "Payment contract not found" });
      return;
    }
    if (feeType && !["funded", "in_delivery"].includes(contract.status)) {
      res.status(409).json({ error: "Dispute fees require confirmed contract funding" });
      return;
    }
    if (feeType && !await hasConfirmedContractFunding(contract.id, contract.buyer_id ?? "")) {
      res.status(409).json({ error: "A confirmed Pi contract payment is required before a dispute fee" });
      return;
    }
    if (!feeType) await getPaymentFeeSettings();
    const disputeFee = feeType
      ? await expectedDisputeFeeForPayment(paymentId, userId)
      : undefined;
    const payment = await verifyIncomingPayment(paymentId, contract, piUid, feeType, disputeFee);
    const alreadyComplete =
      payment.status?.developer_completed &&
      payment.status?.transaction_verified &&
      payment.transaction?.verified &&
      payment.transaction?.txid === txid;
    if (!alreadyComplete && !payment.status?.developer_approved) {
      res.status(409).json({ error: "Pi has not approved this payment" });
      return;
    }
    const completed = alreadyComplete
      ? payment
      : await piRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}/complete`, {
          method: "POST",
          body: JSON.stringify({ txid }),
        });
    const verified = await verifyIncomingPayment(paymentId, contract, piUid, feeType, disputeFee);
    if (
      !verified.status?.developer_approved ||
      !verified.status?.transaction_verified ||
      !verified.transaction?.verified ||
      !verified.status?.developer_completed ||
      verified.status?.cancelled ||
      verified.status?.user_cancelled
    ) {
      res.status(409).json({ error: "Pi did not confirm every required payment state" });
      return;
    }
    if (verified.transaction?.txid !== txid) {
      res.status(409).json({ error: "Pi transaction verification did not match txid" });
      return;
    }
    await savePaymentLedger({
      paymentId,
      contractId: contract.id,
      userId,
      status: feeType ? "fee_confirmed" : "confirmed",
      amount: feeType ? disputeFee! : contract.amount,
      txid,
      feeType: feeType ?? null,
    });
    if (feeType) {
      res.json({ funded: contract.status === "funded", idempotent: false });
      return;
    }
    if (contract.status === "awaiting_funding") {
      const updated = await supabaseRequest<Array<{ id: string }>>(
        `escrow_contracts?id=eq.${encodeURIComponent(contract.id)}&status=eq.awaiting_funding&buyer_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            status: "funded",
            next_action: "Mark delivery in progress",
            updated_at: new Date().toISOString(),
          }),
        },
      );
      if (!updated.length) {
        const latest = await findContract(contract.id);
        if (latest?.status !== "funded") {
          res.status(409).json({ error: "Payment confirmed by Pi, but funding state update was not applied" });
          return;
        }
      }
    } else if (contract.status !== "funded") {
      res.status(409).json({ error: "Contract status changed before funding confirmation" });
      return;
    }
    res.json({ funded: true, idempotent: alreadyComplete });
  } catch (error) {
    req.log.error({ err: error }, "Pi payment completion failed");
    res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Pi payment completion failed" });
  }
});

export default router;