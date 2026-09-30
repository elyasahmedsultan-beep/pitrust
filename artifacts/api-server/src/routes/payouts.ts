import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  DecideAdminDisputeBody,
  DecideAdminDisputeParams,
  DecideAdminDisputeResponse,
  RefundTestnetContractToWalletParams,
  RefundTestnetContractToWalletResponse,
  ReleaseContractToTestnetWalletParams,
  GetContractResponse,
  ListAdminPayoutsResponse,
  ReconcileAdminPayoutsResponse,
} from "@workspace/api-zod";
import { addActivity, findContract, mapContract, type ContractRow } from "../lib/escrow";
import {
  createPiA2USdk,
  currentPiNetwork,
  matchesPayoutPayment,
  payoutAmountAsNumber,
  payoutPaymentIsCompleted,
  payoutPaymentMetadata,
  payoutExecutionEnabled,
  type PayoutSnapshot,
} from "../lib/piA2u";
import {
  scanAutoReleaseCandidates,
  type AutoReleaseCandidate,
} from "../lib/autoReleaseScan";
import { authenticatedUserId, requireSession } from "../lib/session";
import { supabaseRequest } from "../lib/supabase";
import { getPaymentFeeSettings } from "../lib/appSettings";
import { requireArbitrator } from "../lib/arbitratorAccess";
import { hasAdminPasswordSession } from "../lib/adminPasswordAuth";
import { isTestnetWalletHostAllowed } from "../lib/testnetWalletAccess";
import { logger } from "../lib/logger";
import {
  isValidPiWalletAddress,
  payoutWalletForPiUid,
} from "../lib/piWallet";

type PayoutRow = PayoutSnapshot & {
  status: string;
  created_at: string;
  updated_at: string;
  purpose: "standard_release" | "arbitration_release" | "arbitration_refund";
  dispute_id: string | null;
};

type PreparedPayout = {
  created: boolean;
  intent_id: string;
  status: string;
  amount: number | string;
  platform_fee: number | string;
  inviter_reward: number | string;
  seller_amount: number | string;
  recipient_uid: string;
  inviter_id: string | null;
  payment_id: string | null;
  txid: string | null;
  network: string;
  purpose: string;
  dispute_id: string | null;
};

const router: IRouter = Router();
router.use("/admin", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.use((req, res, next) => {
  if (
    (req.method === "GET" && req.path === "/listing-ad-fee") ||
    (req.method === "GET" && (req.path === "/rooms" || req.path === "/chat/rooms")) ||
    req.path === "/admin" ||
    req.path.startsWith("/admin/")
  ) {
    next();
    return;
  }
  requireSession(req, res, next);
});

function errorStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: number }).status)
    : 500;
}

async function markManual(intentId: string): Promise<void> {
  await supabaseRequest<boolean>("rpc/mark_escrow_payout_manual", {
    method: "POST",
    body: JSON.stringify({ p_intent_id: intentId }),
  });
}

async function recordTxid(intentId: string, paymentId: string, txid: string): Promise<void> {
  const rows = await supabaseRequest<Array<{ status: string }>>("rpc/record_escrow_payout_txid", {
    method: "POST",
    body: JSON.stringify({ p_intent_id: intentId, p_payment_id: paymentId, p_txid: txid }),
  });
  if (!rows[0]) throw new Error("Payout txid was not durably recorded");
}

async function settlePayout(intent: PayoutSnapshot, paymentId: string, txid: string): Promise<void> {
  const rows = await supabaseRequest<Array<{ status: string; contract_id: string }>>(
    "rpc/settle_confirmed_escrow_payout",
    {
      method: "POST",
      body: JSON.stringify({
        p_intent_id: intent.id,
        p_payment_id: paymentId,
        p_txid: txid,
      }),
    },
  );
  if (!rows[0] || rows[0].status !== "confirmed") {
    throw new Error("Confirmed A2U payout was not settled atomically");
  }
}

async function notifyWalletMismatch(payout: PayoutSnapshot): Promise<void> {
  try {
    const contract = await findContract(payout.contract_id);
    const userId = payout.purpose === "arbitration_refund"
      ? contract?.buyer_id
      : contract?.seller_id;
    if (!userId) return;
    await supabaseRequest("escrow_notifications", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        contract_id: payout.contract_id,
        type: "wallet_mismatch",
        title: "Payout paused: verify your Pi wallet",
        message: "The registered Pi UID and G-address no longer match this payout. No transfer was broadcast. Link the correct Pi account and valid G-address, then contact support to resume safely.",
        dedupe_key: `wallet-mismatch:${payout.id}`,
      }),
    });
  } catch (error) {
    logger.warn({
      payoutIntentId: payout.id,
      errorType: error instanceof Error ? error.name : "unknown",
    }, "Could not create payout wallet-mismatch notification");
  }
}

async function verifyLivePayoutWallet(payout: PayoutSnapshot): Promise<void> {
  const identity = await payoutWalletForPiUid(payout.recipient_address);
  if (
    !identity ||
    !isValidPiWalletAddress(identity.walletAddress) ||
    !payout.recipient_wallet_address ||
    identity.walletAddress !== payout.recipient_wallet_address
  ) {
    await notifyWalletMismatch(payout);
    throw new Error("Registered Pi UID and G-address do not match the persisted payout destination; no A2U transfer was broadcast");
  }
}

async function loadPersistedWalletSnapshot(payout: PayoutSnapshot): Promise<void> {
  const rows = await supabaseRequest<Array<{ recipient_wallet_address: string | null }>>(
    `escrow_payout_intents?id=eq.${encodeURIComponent(payout.id)}&select=recipient_wallet_address&limit=1`,
  );
  payout.recipient_wallet_address = rows[0]?.recipient_wallet_address ?? null;
  await verifyLivePayoutWallet(payout);
}

async function settleArbitrationPayout(intentId: string, paymentId: string, txid: string): Promise<void> {
  const rows = await supabaseRequest<Array<{ status: string; contract_id: string }>>(
    "rpc/settle_confirmed_arbitration_payout",
    {
      method: "POST",
      body: JSON.stringify({
        p_intent_id: intentId,
        p_payment_id: paymentId,
        p_txid: txid,
      }),
    },
  );
  if (!rows[0] || rows[0].status !== "confirmed") {
    throw new Error("Confirmed arbitration A2U payout was not settled atomically");
  }
}

async function finishVerifiedPayment(
  sdk: ReturnType<typeof createPiA2USdk>,
  payout: PayoutRow,
  paymentId: string,
): Promise<void> {
  await verifyLivePayoutWallet(payout);
  if (!payoutExecutionEnabled() || payout.network !== currentPiNetwork()) {
    throw new Error("A2U reconciliation requires an enabled payout on the explicitly selected Pi network");
  }
  const payment = await sdk.getPayment(paymentId);
  if (!matchesPayoutPayment(payment, payout)) {
    throw new Error("Pi payout DTO does not match its persisted intent");
  }
  const txid = payment.transaction?.txid;
  if (!txid || payment.transaction?.verified !== true) {
    throw new Error("Pi has no verified payout transaction; manual reconciliation remains required");
  }
  await recordTxid(payout.id, paymentId, txid);
  const claimed = await supabaseRequest<boolean>("rpc/claim_escrow_payout_completion", {
    method: "POST",
    body: JSON.stringify({ p_intent_id: payout.id }),
  });
  if (!claimed && payout.status !== "completing" && payout.status !== "manual_reconciliation") {
    throw new Error("Payout completion is not in an eligible persisted state");
  }
  if (!payoutPaymentIsCompleted(payment, txid)) {
    await sdk.completePayment(paymentId, txid);
  }
  const completed = await sdk.getPayment(paymentId);
  if (
    !matchesPayoutPayment(completed, { ...payout, pi_payment_id: paymentId }) ||
    !payoutPaymentIsCompleted(completed, txid)
  ) {
    throw new Error("Pi did not confirm the verified and completed A2U transaction");
  }
  await settlePayout({ ...payout, pi_payment_id: paymentId, txid }, paymentId, txid);
}

async function finishVerifiedArbitrationPayment(
  sdk: ReturnType<typeof createPiA2USdk>,
  payout: PayoutRow,
  paymentId: string,
): Promise<void> {
  await verifyLivePayoutWallet(payout);
  if (
    !payoutExecutionEnabled() ||
    !currentPiNetwork() ||
    payout.network !== currentPiNetwork() ||
    !["arbitration_release", "arbitration_refund"].includes(payout.purpose) ||
    !payout.dispute_id
  ) {
    throw new Error("Arbitration A2U reconciliation requires an enabled arbitration intent on the selected Pi network");
  }
  const payment = await sdk.getPayment(paymentId);
  if (!matchesPayoutPayment(payment, payout)) {
    throw new Error("Pi payout DTO does not match its persisted arbitration intent");
  }
  const txid = payment.transaction?.txid;
  if (!txid || payment.transaction?.verified !== true) {
    throw new Error("Pi has no verified arbitration payout transaction");
  }
  await recordTxid(payout.id, paymentId, txid);
  const claimed = await supabaseRequest<boolean>("rpc/claim_escrow_payout_completion", {
    method: "POST",
    body: JSON.stringify({ p_intent_id: payout.id }),
  });
  if (!claimed && payout.status !== "completing" && payout.status !== "manual_reconciliation") {
    throw new Error("Arbitration payout completion is not in an eligible persisted state");
  }
  if (!payoutPaymentIsCompleted(payment, txid)) {
    await sdk.completePayment(paymentId, txid);
  }
  const completed = await sdk.getPayment(paymentId);
  if (
    !matchesPayoutPayment(completed, { ...payout, pi_payment_id: paymentId }) ||
    !payoutPaymentIsCompleted(completed, txid)
  ) {
    throw new Error("Pi did not confirm the exact completed arbitration A2U transaction");
  }
  await settleArbitrationPayout(payout.id, paymentId, txid);
}

router.post("/contracts/:id/release", async (req, res): Promise<void> => {
  if (isTestnetWalletHostAllowed(req.hostname)) {
    res.status(409).json({
      error: "Testnet escrow releases use the internal wallet; no Pi A2U transfer was attempted",
    });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const actor = authenticatedUserId(req)!;
  let intentId: string | null = null;
  let paymentId: string | null = null;
  let settled = false;
  try {
    if (!payoutExecutionEnabled()) {
      res.status(503).json({ error: "Pi A2U payouts are disabled for the selected network or its credentials are missing; no transfer was attempted" });
      return;
    }
    const network = currentPiNetwork();
    if (!network) {
      res.status(503).json({ error: "Pi payout network is not configured; no transfer was attempted" });
      return;
    }
    await getPaymentFeeSettings();
    // Validate all server credentials before reserving the one-per-contract payout
    // row. If SDK initialization fails, no stale intent should block a later retry.
    const sdk = createPiA2USdk();
    const preparedRows = await supabaseRequest<PreparedPayout[]>("rpc/prepare_escrow_payout", {
      method: "POST",
      body: JSON.stringify({
        p_intent_id: randomUUID(),
        p_contract_id: id,
        p_actor_id: actor,
        p_network: network,
      }),
    });
    const prepared = preparedRows[0];
    if (!prepared) {
      res.status(409).json({ error: "Escrow payout intent could not be created" });
      return;
    }
    const payout: PayoutSnapshot = {
      id: prepared.intent_id,
      contract_id: id,
      amount: prepared.amount,
      platform_fee: prepared.platform_fee,
      inviter_reward: prepared.inviter_reward,
      seller_amount: prepared.seller_amount,
      recipient_address: prepared.recipient_uid,
      recipient_wallet_address: null,
      inviter_id: prepared.inviter_id,
      pi_payment_id: prepared.payment_id,
      txid: prepared.txid,
      network: prepared.network,
    };
    intentId = payout.id;
    if (!prepared.created) {
      if (prepared.status === "confirmed") {
        const contract = await findContract(id);
        if (contract) {
          res.json(GetContractResponse.parse(mapContract(contract)));
          return;
        }
      }
      res.status(202).json({ payoutIntentId: payout.id, status: prepared.status });
      return;
    }

    await loadPersistedWalletSnapshot(payout);
    payoutAmountAsNumber(payout.amount);
    payoutAmountAsNumber(payout.platform_fee);
    payoutAmountAsNumber(payout.inviter_reward);
    const sellerAmount = payoutAmountAsNumber(payout.seller_amount);
    paymentId = await sdk.createPayment({
      amount: sellerAmount,
      memo: `Escrow release ${id}`,
      uid: payout.recipient_address,
      metadata: payoutPaymentMetadata(payout),
    });
    if (!paymentId.trim()) throw new Error("Pi did not return an A2U payment id");

    await supabaseRequest<Array<{ status: string }>>("rpc/store_escrow_payout_payment", {
      method: "POST",
      body: JSON.stringify({
        p_intent_id: payout.id,
        p_payment_id: paymentId,
        p_manual: false,
      }),
    });

    // The SDK signs and broadcasts using the payment DTO's recipient, amount, and
    // network. Re-fetch and verify the platform-owned payment before submitPayment.
    const createdPayment = await sdk.getPayment(paymentId);
    if (!matchesPayoutPayment(createdPayment, { ...payout, pi_payment_id: paymentId })) {
      if (
        createdPayment.to_address !== payout.recipient_wallet_address ||
        createdPayment.user_uid !== payout.recipient_address
      ) await notifyWalletMismatch(payout);
      await markManual(payout.id);
      res.status(202).json({
        payoutIntentId: payout.id,
        status: "manual_reconciliation",
        error: "Pi-created payment did not match the verified recipient, amount, network, and escrow intent; no transaction was broadcast",
      });
      return;
    }

    const claimed = await supabaseRequest<boolean>("rpc/claim_escrow_payout_submission", {
      method: "POST",
      body: JSON.stringify({ p_intent_id: payout.id }),
    });
    if (!claimed) {
      await markManual(payout.id);
      res.status(202).json({ payoutIntentId: payout.id, status: "manual_reconciliation" });
      return;
    }

    await verifyLivePayoutWallet(payout);
    const beforeSubmit = await sdk.getPayment(paymentId);
    if (!matchesPayoutPayment(beforeSubmit, { ...payout, pi_payment_id: paymentId })) {
      if (
        beforeSubmit.to_address !== payout.recipient_wallet_address ||
        beforeSubmit.user_uid !== payout.recipient_address
      ) await notifyWalletMismatch(payout);
      await markManual(payout.id);
      res.status(202).json({
        payoutIntentId: payout.id,
        status: "manual_reconciliation",
        error: "The live Pi payment recipient no longer matches the registered Pi UID and G-address; no transfer was broadcast",
      });
      return;
    }
    const txid = await sdk.submitPayment(paymentId);
    if (!txid?.trim()) throw new Error("Pi did not return an A2U transaction id");
    await recordTxid(payout.id, paymentId, txid);

    const completing = await supabaseRequest<boolean>("rpc/claim_escrow_payout_completion", {
      method: "POST",
      body: JSON.stringify({ p_intent_id: payout.id }),
    });
    if (!completing) {
      await markManual(payout.id);
      res.status(202).json({ payoutIntentId: payout.id, status: "manual_reconciliation" });
      return;
    }

    const completed = await sdk.completePayment(paymentId, txid);
    const verified = await sdk.getPayment(paymentId);
    if (
      !matchesPayoutPayment(completed, { ...payout, pi_payment_id: paymentId }) ||
      !payoutPaymentIsCompleted(completed, txid) ||
      !matchesPayoutPayment(verified, { ...payout, pi_payment_id: paymentId }) ||
      !payoutPaymentIsCompleted(verified, txid)
    ) {
      throw new Error("Pi did not confirm the exact completed A2U transaction");
    }
    await settlePayout({ ...payout, pi_payment_id: paymentId, txid }, paymentId, txid);
    settled = true;
    await addActivity(id, {
      type: "payment_released",
      title: "Payment released",
      description: "Pi confirmed the seller A2U payout and the platform fee was settled.",
      actor: "Escrow system",
      tone: "positive",
    }).catch((error: unknown) => {
      req.log.warn({ payoutIntentId: intentId, errorType: error instanceof Error ? error.name : "unknown" }, "Payout confirmed but activity entry failed");
    });
    const contract: ContractRow | null = await findContract(id);
    if (!contract) {
      res.status(503).json({ error: "Payout is confirmed but contract response needs reconciliation" });
      return;
    }
    res.json(GetContractResponse.parse(mapContract(contract)));
  } catch (error) {
    req.log.error({
      payoutIntentId: intentId,
      errorType: error instanceof Error ? error.name : "unknown",
    }, "Pi A2U payout requires reconciliation");
    if (settled && intentId) {
      res.status(503).json({
        payoutIntentId: intentId,
        status: "confirmed",
        error: "Pi confirmed the payout; contract response requires reconciliation",
      });
      return;
    }
    if (intentId) {
      if (paymentId) {
        await supabaseRequest("rpc/store_escrow_payout_payment", {
          method: "POST",
          body: JSON.stringify({ p_intent_id: intentId, p_payment_id: paymentId, p_manual: true }),
        }).catch(() => undefined);
      }
      await markManual(intentId).catch(() => undefined);
      res.status(202).json({ payoutIntentId: intentId, status: "manual_reconciliation" });
      return;
    }
    res.status(errorStatus(error)).json({ error: "Payout was not started; no Pi transfer was attempted" });
  }
});

router.post("/contracts/:id/release-wallet", async (req, res): Promise<void> => {
  if (!isTestnetWalletHostAllowed(req.hostname)) {
    res.status(404).json({ error: "Internal Testnet escrow release is unavailable on this host" });
    return;
  }
  const params = ReleaseContractToTestnetWalletParams.safeParse({
    id: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const actor = authenticatedUserId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const rows = await supabaseRequest<Array<{
      success: boolean;
      reason: string | null;
      idempotent: boolean;
      balance: number | string | null;
      transaction_id: string | null;
    }>>("rpc/release_testnet_escrow_to_wallet", {
      method: "POST",
      body: JSON.stringify({
        p_contract_id: id,
        p_user_id: actor,
      }),
    });
    const result = rows[0];
    if (!result) {
      res.status(503).json({ error: "Testnet escrow release did not return a result" });
      return;
    }
    if (!result.success) {
      const status = result.reason === "contract_not_found" ? 404 : 409;
      const errorByReason: Record<string, string> = {
        contract_not_releasable: "This escrow is not ready for Testnet wallet release",
        testnet_funding_required: "This escrow was not funded from a Testnet wallet",
        delivery_evidence_required: "Seller delivery evidence is required before release",
        open_dispute: "An open dispute prevents escrow release",
      };
      res.status(status).json({
        error: errorByReason[result.reason ?? ""] ?? "Could not release this escrow to the Testnet wallet",
      });
      return;
    }
    const contract = await findContract(id);
    if (!contract) {
      res.status(503).json({ error: "Escrow was released but its current state could not be loaded" });
      return;
    }
    res.json(GetContractResponse.parse(mapContract(contract)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to release escrow to Testnet wallet");
    res.status(errorStatus(error)).json({ error: "Could not release escrow to the Testnet wallet" });
  }
});

router.post("/contracts/:id/refund-wallet", async (req, res): Promise<void> => {
  if (!isTestnetWalletHostAllowed(req.hostname)) {
    res.status(404).json({ error: "Internal Testnet escrow refund is unavailable on this host" });
    return;
  }
  const params = RefundTestnetContractToWalletParams.safeParse({
    id: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = authenticatedUserId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const rows = await supabaseRequest<Array<{
      success: boolean;
      reason: string;
      idempotent: boolean;
      balance: number | string | null;
      transaction_id: string | null;
    }>>("rpc/refund_testnet_escrow_to_wallet", {
      method: "POST",
      body: JSON.stringify({ p_contract_id: params.data.id, p_user_id: actor }),
    });
    const result = rows[0];
    if (!result) {
      res.status(503).json({ error: "Testnet refund did not return a database result" });
      return;
    }
    if (!result.success) {
      const status = result.reason === "contract_not_found" ? 404 :
        result.reason === "buyer_only" ? 403 : 409;
      const messages: Record<string, string> = {
        contract_not_found: "Contract not found",
        buyer_only: "Only the buyer can request this Testnet refund",
        contract_not_refundable: "This Testnet escrow cannot be refunded directly in its current state",
        testnet_funding_required: "This contract was not funded from the Testnet wallet",
        wallet_not_found: "Buyer Testnet wallet was not found",
      };
      res.status(status).json({ error: messages[result.reason] ?? "Could not refund this Testnet escrow" });
      return;
    }
    if (result.balance === null || !result.transaction_id) {
      res.status(503).json({ error: "Testnet refund confirmation is incomplete" });
      return;
    }
    res.json(RefundTestnetContractToWalletResponse.parse({
      refunded: true,
      idempotent: result.idempotent,
      balance: Number(result.balance),
      transactionId: result.transaction_id,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to refund escrow to Testnet wallet");
    res.status(errorStatus(error)).json({ error: "Could not refund this escrow to the Testnet wallet" });
  }
});

router.post("/admin/disputes/:id/decide", async (req, res): Promise<void> => {
  if (!await requireArbitrator(req, res)) return;
  const params = DecideAdminDisputeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = DecideAdminDisputeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (body.data.confirmation !== body.data.decision.toUpperCase()) {
    res.status(400).json({ error: "Decision confirmation must exactly match the selected action" });
    return;
  }
  if (!payoutExecutionEnabled()) {
    res.status(503).json({
      error: "Arbitration payouts are disabled for the selected network or its credentials are missing; no transfer was attempted",
    });
    return;
  }
  const network = currentPiNetwork();
  if (!network) {
    res.status(503).json({ error: "Arbitration payout network is not configured; no transfer was attempted" });
    return;
  }

  const actor = authenticatedUserId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  let intentId: string | null = null;
  let paymentId: string | null = null;
  let contractId = "";
  try {
    // Initialize credentials before reserving a payout intent.
    const sdk = createPiA2USdk();
    const expectedPurpose = body.data.decision === "release"
      ? "arbitration_release"
      : "arbitration_refund";
    const existingIntents = await supabaseRequest<Array<{
      id: string;
      purpose: string;
      dispute_id: string | null;
      arbitrator_id: string | null;
      reason: string | null;
      network: string;
    }>>(
      `escrow_payout_intents?dispute_id=eq.${encodeURIComponent(params.data.id)}&select=id,purpose,dispute_id,arbitrator_id,reason,network&limit=2`,
    );
    if (existingIntents.length > 1) {
      res.status(409).json({ error: "Multiple payout intents conflict with this dispute" });
      return;
    }
    const existingIntent = existingIntents[0];
    if (existingIntent) {
      const existing = existingIntent;
      if (
        existing.purpose !== expectedPurpose ||
        existing.dispute_id !== params.data.id ||
        existing.arbitrator_id !== actor ||
        existing.reason !== body.data.reason ||
        existing.network !== network
      ) {
        res.status(409).json({ error: "An existing payout intent conflicts with this arbitration decision" });
        return;
      }
      intentId = existing.id;
    }
    const candidateIntentId = existingIntent?.id ?? randomUUID();
    const preparedRows = await supabaseRequest<PreparedPayout[]>(
      "rpc/prepare_arbitration_payout",
      {
        method: "POST",
        body: JSON.stringify({
          p_intent_id: candidateIntentId,
          p_dispute_id: params.data.id,
          p_actor_id: actor,
          p_decision: body.data.decision,
          p_reason: body.data.reason,
          p_network: network,
        }),
      },
    );
    const prepared = preparedRows[0];
    if (!prepared) {
      res.status(409).json({ error: "Arbitration payout intent could not be prepared" });
      return;
    }
    intentId = prepared.intent_id;
    if (prepared.purpose !== expectedPurpose || prepared.dispute_id !== params.data.id) {
      res.status(409).json({ error: "Persisted payout intent conflicts with this arbitration decision" });
      return;
    }
    const intentRows = await supabaseRequest<Array<{ contract_id: string }>>(
      `escrow_payout_intents?id=eq.${encodeURIComponent(prepared.intent_id)}&select=contract_id&limit=1`,
    );
    contractId = intentRows[0]?.contract_id ?? "";
    if (!contractId) throw new Error("Prepared arbitration intent has no persisted contract");
    const payout: PayoutSnapshot = {
      id: prepared.intent_id,
      contract_id: contractId,
      amount: prepared.amount,
      platform_fee: prepared.platform_fee,
      inviter_reward: prepared.inviter_reward,
      seller_amount: prepared.seller_amount,
      recipient_address: prepared.recipient_uid,
      recipient_wallet_address: null,
      inviter_id: prepared.inviter_id,
      pi_payment_id: prepared.payment_id,
      txid: prepared.txid,
      network: prepared.network,
      purpose: expectedPurpose,
      dispute_id: prepared.dispute_id,
    };
    if (!prepared.created) {
      const response = {
        disputeId: params.data.id,
        contractId,
        decision: body.data.decision,
        payoutIntentId: prepared.intent_id,
        status: prepared.status,
        paymentId: prepared.payment_id,
        txid: prepared.txid,
      };
      // Never recreate or resubmit an already-reserved payout. Only the SQL
      // confirmed state, which follows Pi DTO verification, is success.
      if (prepared.status === "confirmed" && prepared.payment_id && prepared.txid) {
        res.status(200).json(DecideAdminDisputeResponse.parse(response));
      } else {
        res.status(202).json(DecideAdminDisputeResponse.parse({
          ...response,
          status: prepared.status,
        }));
      }
      return;
    }

    await loadPersistedWalletSnapshot(payout);
    // Never accept a client-supplied contract, recipient, or amount.
    const grossAmount = payoutAmountAsNumber(payout.amount);
    const platformFee = payoutAmountAsNumber(payout.platform_fee);
    const inviterReward = payoutAmountAsNumber(payout.inviter_reward);
    const transferAmount = payoutAmountAsNumber(payout.seller_amount);
    if (body.data.decision === "refund" &&
      (platformFee !== 0 || inviterReward !== 0 || transferAmount !== grossAmount)) {
      throw new Error("Persisted arbitration refund is not a zero-fee gross buyer refund");
    }

    paymentId = await sdk.createPayment({
      amount: transferAmount,
      memo: `Escrow arbitration ${body.data.decision} ${params.data.id}`,
      uid: payout.recipient_address,
      metadata: payoutPaymentMetadata(payout),
    });
    if (!paymentId.trim()) throw new Error("Pi did not return an A2U payment id");
    const stored = await supabaseRequest<Array<{ status: string }>>(
      "rpc/store_escrow_payout_payment",
      {
        method: "POST",
        body: JSON.stringify({
          p_intent_id: payout.id,
          p_payment_id: paymentId,
          p_manual: false,
        }),
      },
    );
    if (!stored[0]) throw new Error("Pi payment id was not durably linked to the arbitration intent");

    const createdPayment = await sdk.getPayment(paymentId);
    if (!matchesPayoutPayment(createdPayment, { ...payout, pi_payment_id: paymentId })) {
      if (
        createdPayment.to_address !== payout.recipient_wallet_address ||
        createdPayment.user_uid !== payout.recipient_address
      ) await notifyWalletMismatch(payout);
      throw new Error("Pi-created payment does not match the exact arbitration intent");
    }
    const claimedSubmission = await supabaseRequest<boolean>(
      "rpc/claim_escrow_payout_submission",
      {
        method: "POST",
        body: JSON.stringify({ p_intent_id: payout.id }),
      },
    );
    if (!claimedSubmission) throw new Error("Arbitration payout submission could not be claimed");

    await verifyLivePayoutWallet(payout);
    const beforeSubmit = await sdk.getPayment(paymentId);
    if (!matchesPayoutPayment(beforeSubmit, { ...payout, pi_payment_id: paymentId })) {
      if (
        beforeSubmit.to_address !== payout.recipient_wallet_address ||
        beforeSubmit.user_uid !== payout.recipient_address
      ) await notifyWalletMismatch(payout);
      await markManual(payout.id);
      throw new Error("Live Pi payment recipient no longer matches the registered Pi UID and G-address; no transfer was broadcast");
    }
    const txid = await sdk.submitPayment(paymentId);
    if (!txid?.trim()) throw new Error("Pi did not return an A2U transaction id");
    await recordTxid(payout.id, paymentId, txid);
    const claimedCompletion = await supabaseRequest<boolean>(
      "rpc/claim_escrow_payout_completion",
      {
        method: "POST",
        body: JSON.stringify({ p_intent_id: payout.id }),
      },
    );
    if (!claimedCompletion) throw new Error("Arbitration payout completion could not be claimed");

    const completedPayment = await sdk.completePayment(paymentId, txid);
    const verifiedPayment = await sdk.getPayment(paymentId);
    if (
      !matchesPayoutPayment(completedPayment, { ...payout, pi_payment_id: paymentId }) ||
      !payoutPaymentIsCompleted(completedPayment, txid) ||
      !matchesPayoutPayment(verifiedPayment, { ...payout, pi_payment_id: paymentId }) ||
      !payoutPaymentIsCompleted(verifiedPayment, txid)
    ) {
      throw new Error("Pi did not confirm the exact completed arbitration A2U transaction");
    }
    await settleArbitrationPayout(payout.id, paymentId, txid);
    res.status(200).json(DecideAdminDisputeResponse.parse({
      disputeId: params.data.id,
      contractId,
      decision: body.data.decision,
      payoutIntentId: payout.id,
      status: "confirmed",
      paymentId,
      txid,
    }));
  } catch (error) {
    req.log.error({
      payoutIntentId: intentId,
      errorType: error instanceof Error ? error.name : "unknown",
    }, "Arbitration Pi A2U payout requires reconciliation");
    if (!intentId) {
      res.status(errorStatus(error)).json({ error: "Arbitration payout was not reserved; no Pi transfer was attempted" });
      return;
    }
    if (paymentId) {
      await supabaseRequest("rpc/store_escrow_payout_payment", {
        method: "POST",
        body: JSON.stringify({ p_intent_id: intentId, p_payment_id: paymentId, p_manual: true }),
      }).catch(() => undefined);
    }
    await markManual(intentId).catch(() => undefined);
    // Read persisted identifiers for an accurate 202 result when Pi may have
    // accepted a payment or SQL settlement may have committed ambiguously.
    const persisted = await supabaseRequest<Array<{
      contract_id: string;
      purpose: string;
      dispute_id: string;
      pi_payment_id: string | null;
      txid: string | null;
      status: string;
    }>>(
      `escrow_payout_intents?id=eq.${encodeURIComponent(intentId)}&select=contract_id,purpose,dispute_id,pi_payment_id,txid,status&limit=1`,
    ).catch(() => []);
    const row = persisted[0];
    if (!row) {
      res.status(errorStatus(error)).json({
        error: "Arbitration payout could not be persisted; no confirmed Pi transfer is reported",
      });
      return;
    }
    const contractIdForResponse = row?.contract_id || contractId || (await supabaseRequest<Array<{ contract_id: string }>>(
      `escrow_payout_intents?id=eq.${encodeURIComponent(intentId)}&select=contract_id&limit=1`,
    ).then((rows) => rows[0]?.contract_id ?? "").catch(() => ""));
    if (row?.status === "confirmed" && row.pi_payment_id && row.txid) {
      res.status(200).json(DecideAdminDisputeResponse.parse({
        disputeId: row.dispute_id,
        contractId: contractIdForResponse,
        decision: body.data.decision,
        payoutIntentId: intentId,
        status: "confirmed",
        paymentId: row.pi_payment_id,
        txid: row.txid,
      }));
      return;
    }
    res.status(202).json(DecideAdminDisputeResponse.parse({
      disputeId: row?.dispute_id ?? params.data.id,
      contractId: contractIdForResponse,
      decision: body.data.decision,
      payoutIntentId: intentId,
      status: row?.status ?? "manual_reconciliation",
      paymentId: row?.pi_payment_id ?? paymentId,
      txid: row?.txid ?? null,
    }));
  }
});

router.get("/admin/payouts", async (req, res): Promise<void> => {
  if (!hasAdminPasswordSession(req)) {
    res.status(401).json({ error: "Admin password required" });
    return;
  }
  try {
    const rows = await supabaseRequest<PayoutRow[]>(
      "escrow_payout_intents?select=id,contract_id,dispute_id,purpose,inviter_id,amount,platform_fee,inviter_reward,seller_amount,recipient_address,pi_payment_id,txid,status,network,created_at,updated_at&order=updated_at.desc&limit=100",
    );
    res.json(ListAdminPayoutsResponse.parse(rows.map((payout) => ({
      id: payout.id,
      contractId: payout.contract_id,
      disputeId: payout.dispute_id,
      purpose: payout.purpose,
      status: payout.status,
      amount: String(payout.amount),
      platformFee: String(payout.platform_fee),
      inviterReward: String(payout.inviter_reward),
      sellerAmount: String(payout.seller_amount),
      paymentId: payout.pi_payment_id,
      txid: payout.txid,
      network: payout.network,
      createdAt: payout.created_at,
      updatedAt: payout.updated_at,
    }))));
  } catch (error) {
    req.log.error({ err: error }, "Could not load admin payout status");
    res.status(errorStatus(error)).json({ error: "Payout status is unavailable" });
  }
});

router.post("/admin/payouts/reconcile", async (req, res): Promise<void> => {
  if (!await requireArbitrator(req, res)) return;
  if (!payoutExecutionEnabled()) {
    res.status(503).json({ error: "Pi payout reconciliation is disabled for the selected network or its credentials are missing" });
    return;
  }
  const outcomes: Array<{ intentId: string; status: string }> = [];
  try {
    const network = currentPiNetwork();
    if (!network) {
      res.status(503).json({ error: "Pi payout reconciliation network is not configured" });
      return;
    }
    const sdk = createPiA2USdk();
    const incomplete = await sdk.getIncompleteServerPayments();
    const active = await supabaseRequest<PayoutRow[]>(
      `escrow_payout_intents?select=*&network=eq.${encodeURIComponent(network)}&status=in.(creating,created,submitting,submitted,completing,manual_reconciliation)&order=updated_at.asc&limit=100`,
    );
    const byIntentId = new Map(active.map((payout) => [payout.id, payout]));
    const paymentIds = new Map<string, string>();

    for (const candidate of incomplete) {
      const metadata = candidate.metadata as Record<string, unknown> | null;
      const intentId = metadata?.escrowPayoutIntentId;
      if (typeof intentId !== "string") continue;
      const payout = byIntentId.get(intentId);
      if (!payout) continue;
      if (payout.pi_payment_id && payout.pi_payment_id !== candidate.identifier) {
        await markManual(payout.id);
        outcomes.push({ intentId, status: "manual_reconciliation" });
        continue;
      }
      if (payout.purpose !== "standard_release") {
        if (
          !["arbitration_release", "arbitration_refund"].includes(payout.purpose) ||
          !payout.dispute_id
        ) {
          await markManual(payout.id);
          outcomes.push({ intentId, status: "manual_reconciliation" });
          continue;
        }
        // Incomplete-payment listings alone are not authoritative enough to
        // attach an identifier to an arbitration intent.
        let candidateMatches = false;
        try {
          const candidatePayment = await sdk.getPayment(candidate.identifier);
          candidateMatches = matchesPayoutPayment(candidatePayment, payout);
        } catch (error) {
          req.log.warn({
            payoutIntentId: payout.id,
            errorType: error instanceof Error ? error.name : "unknown",
          }, "Could not validate candidate arbitration payment");
        }
        if (!candidateMatches) {
          await markManual(payout.id);
          outcomes.push({ intentId, status: "manual_reconciliation" });
          continue;
        }
      }
      if (!payout.pi_payment_id) {
        try {
          await supabaseRequest("rpc/store_escrow_payout_payment", {
            method: "POST",
            body: JSON.stringify({
              p_intent_id: payout.id,
              p_payment_id: candidate.identifier,
              p_manual: true,
            }),
          });
        } catch (error) {
          if (payout.purpose !== "standard_release") {
            req.log.warn({
              payoutIntentId: payout.id,
              errorType: error instanceof Error ? error.name : "unknown",
            }, "Could not persist candidate arbitration payment");
            await markManual(payout.id).catch(() => undefined);
            outcomes.push({ intentId, status: "manual_reconciliation" });
            continue;
          }
          throw error;
        }
        payout.pi_payment_id = candidate.identifier;
      }
      paymentIds.set(payout.id, candidate.identifier);
    }

    for (const payout of active) {
      if (payout.pi_payment_id) paymentIds.set(payout.id, payout.pi_payment_id);
    }
    for (const [payoutId, candidatePaymentId] of paymentIds) {
      const payout = byIntentId.get(payoutId);
      if (!payout) continue;
      try {
        if (payout.purpose === "standard_release") {
          await finishVerifiedPayment(sdk, payout, candidatePaymentId);
        } else {
          await finishVerifiedArbitrationPayment(sdk, payout, candidatePaymentId);
        }
        outcomes.push({ intentId: payout.id, status: "confirmed" });
      } catch (error) {
        req.log.warn({
          payoutIntentId: payout.id,
          errorType: error instanceof Error ? error.name : "unknown",
        }, "Admin payout reconciliation left intent pending");
        await markManual(payout.id).catch(() => undefined);
        outcomes.push({ intentId: payout.id, status: "manual_reconciliation" });
      }
    }
    res.json(ReconcileAdminPayoutsResponse.parse({
      incompleteServerPayments: incomplete.length,
      inspected: paymentIds.size,
      outcomes,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Pi incomplete server-payment reconciliation failed");
    res.status(503).json({ error: "Pi payout reconciliation failed; existing payout intents remain fail-closed" });
  }
});

async function executeAutoRelease(
  sdk: ReturnType<typeof createPiA2USdk>,
  candidate: AutoReleaseCandidate,
): Promise<void> {
  const payout: PayoutSnapshot = {
    id: candidate.intent_id,
    contract_id: candidate.contract_id,
    amount: candidate.amount,
    platform_fee: candidate.platform_fee,
    inviter_reward: candidate.inviter_reward,
    seller_amount: candidate.seller_amount,
    recipient_address: candidate.recipient_uid,
    recipient_wallet_address: candidate.recipient_wallet_address,
    inviter_id: candidate.inviter_id,
    pi_payment_id: candidate.payment_id,
    txid: candidate.txid,
    network: candidate.network,
    purpose: candidate.purpose,
    dispute_id: candidate.dispute_id,
  };

  try {
    await verifyLivePayoutWallet(payout);
    const amount = payoutAmountAsNumber(payout.seller_amount);
    const paymentId = await sdk.createPayment({
      amount,
      memo: `Escrow automatic release ${payout.contract_id}`,
      uid: payout.recipient_address,
      metadata: payoutPaymentMetadata(payout),
    });
    if (!paymentId.trim()) throw new Error("Pi did not return an A2U payment id");
    await supabaseRequest("rpc/store_escrow_payout_payment", {
      method: "POST",
      body: JSON.stringify({
        p_intent_id: payout.id,
        p_payment_id: paymentId,
        p_manual: false,
      }),
    });

    const createdPayment = await sdk.getPayment(paymentId);
    if (!matchesPayoutPayment(createdPayment, { ...payout, pi_payment_id: paymentId })) {
      if (
        createdPayment.to_address !== payout.recipient_wallet_address ||
        createdPayment.user_uid !== payout.recipient_address
      ) await notifyWalletMismatch(payout);
      await markManual(payout.id);
      return;
    }
    const claimed = await supabaseRequest<boolean>("rpc/claim_escrow_payout_submission", {
      method: "POST",
      body: JSON.stringify({ p_intent_id: payout.id }),
    });
    if (!claimed) {
      await markManual(payout.id);
      return;
    }

    await verifyLivePayoutWallet(payout);
    const beforeSubmit = await sdk.getPayment(paymentId);
    if (!matchesPayoutPayment(beforeSubmit, { ...payout, pi_payment_id: paymentId })) {
      if (
        beforeSubmit.to_address !== payout.recipient_wallet_address ||
        beforeSubmit.user_uid !== payout.recipient_address
      ) await notifyWalletMismatch(payout);
      await markManual(payout.id);
      return;
    }
    const txid = await sdk.submitPayment(paymentId);
    if (!txid?.trim()) throw new Error("Pi did not return an A2U transaction id");
    await recordTxid(payout.id, paymentId, txid);

    const completing = await supabaseRequest<boolean>("rpc/claim_escrow_payout_completion", {
      method: "POST",
      body: JSON.stringify({ p_intent_id: payout.id }),
    });
    if (!completing) throw new Error("Automatic payout completion could not be claimed");
    const completed = await sdk.completePayment(paymentId, txid);
    const verified = await sdk.getPayment(paymentId);
    if (
      !matchesPayoutPayment(completed, { ...payout, pi_payment_id: paymentId }) ||
      !payoutPaymentIsCompleted(completed, txid) ||
      !matchesPayoutPayment(verified, { ...payout, pi_payment_id: paymentId }) ||
      !payoutPaymentIsCompleted(verified, txid)
    ) {
      throw new Error("Pi did not confirm the exact completed automatic A2U transaction");
    }
    await settlePayout({ ...payout, pi_payment_id: paymentId, txid }, paymentId, txid);
  } catch (error) {
    await markManual(payout.id).catch(() => undefined);
    logger.error({
      payoutIntentId: payout.id,
      errorType: error instanceof Error ? error.name : "unknown",
    }, "Automatic escrow release requires reconciliation");
  }
}

export function startAutomaticEscrowReleaseWorker(): () => void {
  let active = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (active || stopped || !payoutExecutionEnabled()) return;
    const network = currentPiNetwork();
    if (!network) return;
    active = true;
    try {
      const sdk = createPiA2USdk();
      await scanAutoReleaseCandidates(
        () => supabaseRequest<unknown>(
          "rpc/claim_eligible_escrow_auto_release",
          {
            method: "POST",
            body: JSON.stringify({ p_intent_id: randomUUID(), p_network: network }),
          },
        ),
        (candidate) => executeAutoRelease(sdk, candidate),
        { shouldStop: () => stopped, maxCandidates: 12 },
      );
    } catch (error) {
      logger.warn({
        errorType: error instanceof Error ? error.name : "unknown",
      }, "Automatic escrow release scan did not complete");
    } finally {
      active = false;
    }
  };

  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export default router;