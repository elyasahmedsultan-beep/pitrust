import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  ClaimTestnetFaucetResponse,
  GetTestnetWalletResponse,
  TransferTestnetWalletBody,
  TransferTestnetWalletResponse,
} from "@workspace/api-zod";
import { fixedPiUnits } from "../lib/pi";
import { authenticatedUserId, requireSession } from "../lib/session";
import { requireTestnetWalletAccess } from "../lib/testnetWalletAccess";
import { isMissingSupabaseRelation, supabaseRequest } from "../lib/supabase";

const router: IRouter = Router();
router.use("/wallet", requireTestnetWalletAccess);
router.use("/wallet", requireSession);

type WalletTransactionRow = {
  id: string;
  group_id: string;
  transaction_type: string;
  direction: string;
  amount: number | string;
  balance_after: number | string;
  status: string;
  counterparty_user_id: string | null;
  contract_id: string | null;
  created_at: string;
};

function errorStatus(error: unknown): number {
  if (isMissingSupabaseRelation(error)) return 503;
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: number }).status)
    : 500;
}

async function ensureWalletProfile(actor: string): Promise<void> {
  const query = `escrow_profiles?user_id=eq.${encodeURIComponent(actor)}&select=user_id&limit=1`;
  const existing = await supabaseRequest<Array<{ user_id: string }>>(query);
  if (existing[0]) return;

  try {
    await supabaseRequest("escrow_profiles", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: actor,
        display_name: "Member",
        referral_code: randomUUID().replaceAll("-", "").slice(0, 12),
      }),
    });
  } catch (error) {
    const racedProfile = await supabaseRequest<Array<{ user_id: string }>>(query).catch(() => []);
    if (!racedProfile[0]) throw error;
  }
}

function mapTransaction(
  row: WalletTransactionRow,
  counterpartyAddress: string | null,
) {
  return {
    id: row.id,
    groupId: row.group_id,
    type: row.transaction_type,
    direction: row.direction,
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    status: row.status,
    counterpartyAddress,
    contractId: row.contract_id,
    createdAt: row.created_at,
  };
}

router.get("/wallet", async (req, res): Promise<void> => {
  const actor = authenticatedUserId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    await ensureWalletProfile(actor);
    const actorFilter = encodeURIComponent(actor);
    const [accounts, transactionRows] = await Promise.all([
      supabaseRequest<Array<{
        wallet_address: string;
        balance: number | string;
        last_faucet_claim_at: string | null;
      }>>(
        `testnet_wallet_accounts?user_id=eq.${actorFilter}&select=wallet_address,balance,last_faucet_claim_at&limit=1`,
      ),
      supabaseRequest<WalletTransactionRow[]>(
        `testnet_wallet_transactions?user_id=eq.${actorFilter}&select=id,group_id,transaction_type,direction,amount,balance_after,status,counterparty_user_id,contract_id,created_at&order=created_at.desc&limit=50`,
      ),
    ]);
    const account = accounts[0];
    if (!account) {
      res.status(503).json({ error: "Testnet wallet account is not provisioned" });
      return;
    }

    const counterpartyIds = [...new Set(
      transactionRows
        .map((row) => row.counterparty_user_id)
        .filter((value): value is string => Boolean(value)),
    )];
    const counterpartyAddresses = new Map<string, string>();
    if (counterpartyIds.length) {
      const inFilter = `in.(${counterpartyIds.map((value) => `"${value.replaceAll('"', '\\"')}"`).join(",")})`;
      const counterparties = await supabaseRequest<Array<{ user_id: string; wallet_address: string }>>(
        `testnet_wallet_accounts?user_id=${encodeURIComponent(inFilter)}&select=user_id,wallet_address`,
      );
      for (const counterparty of counterparties) {
        counterpartyAddresses.set(counterparty.user_id, counterparty.wallet_address);
      }
    }

    const lastClaimAt = account.last_faucet_claim_at;
    const nextClaimAt = lastClaimAt ? Date.parse(lastClaimAt) + 72 * 60 * 60 * 1000 : 0;
    const faucetCooldownRemainingSeconds = lastClaimAt
      ? Math.max(0, Math.ceil((nextClaimAt - Date.now()) / 1000))
      : 0;
    res.json(GetTestnetWalletResponse.parse({
      network: "Pi Testnet",
      address: account.wallet_address,
      balance: Number(account.balance),
      lastFaucetClaimAt: lastClaimAt,
      faucetCooldownRemainingSeconds,
      transactions: transactionRows.map((row) =>
        mapTransaction(row, row.counterparty_user_id
          ? counterpartyAddresses.get(row.counterparty_user_id) ?? null
          : null),
      ),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Testnet wallet");
    res.status(errorStatus(error)).json({ error: "Could not load Testnet wallet" });
  }
});

router.post("/wallet/faucet/claim", async (req, res): Promise<void> => {
  const actor = authenticatedUserId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    await ensureWalletProfile(actor);
    const rows = await supabaseRequest<Array<{
      success: boolean;
      reason: string | null;
      balance: number | string;
      remaining_seconds: number;
      next_claim_at: string | null;
      transaction_id: string | null;
    }>>("rpc/claim_testnet_faucet", {
      method: "POST",
      body: JSON.stringify({ p_user_id: actor }),
    });
    const result = rows[0];
    if (!result) {
      res.status(503).json({ error: "Faucet claim did not return a result" });
      return;
    }
    if (!result.success) {
      const cooldown = result.reason === "cooldown";
      res.status(409).json({
        error: cooldown
          ? "Faucet cooldown is still active"
          : "Wallet balance must be 10 Test-Pi or less before another claim",
        reason: cooldown ? "cooldown" : "balance_too_high",
        remainingSeconds: result.remaining_seconds,
        balance: Number(result.balance),
      });
      return;
    }
    res.json(ClaimTestnetFaucetResponse.parse({
      amount: 100,
      balance: Number(result.balance),
      nextClaimAt: result.next_claim_at,
      transactionId: result.transaction_id,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to claim Testnet faucet balance");
    res.status(errorStatus(error)).json({ error: "Could not claim Test-Pi" });
  }
});

router.post("/wallet/transfers", async (req, res): Promise<void> => {
  const actor = authenticatedUserId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const parsed = TransferTestnetWalletBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (fixedPiUnits(String(parsed.data.amount)) === null) {
    res.status(400).json({ error: "Transfer amount must have no more than eight decimal places" });
    return;
  }

  try {
    await ensureWalletProfile(actor);
    const rows = await supabaseRequest<Array<{
      success: boolean;
      reason: string | null;
      group_id: string | null;
      balance: number | string | null;
      transaction_id: string | null;
    }>>("rpc/transfer_testnet_wallet_balance", {
      method: "POST",
      body: JSON.stringify({
        p_sender_user_id: actor,
        p_recipient: parsed.data.recipient.trim(),
        p_amount: parsed.data.amount,
        p_request_id: parsed.data.requestId,
      }),
    });
    const result = rows[0];
    if (!result) {
      res.status(503).json({ error: "Internal transfer did not return a result" });
      return;
    }
    if (!result.success || !result.group_id || !result.transaction_id || result.balance == null) {
      const errorByReason: Record<string, string> = {
        invalid_amount: "Enter a positive Test-Pi amount with at most eight decimal places",
        invalid_request: "Enter a recipient and try again",
        recipient_ambiguous: "More than one profile has that name; use the recipient's Testnet address",
        recipient_not_found: "No Testnet wallet matches that address or profile name",
        self_transfer: "You cannot send Test-Pi to your own wallet",
        insufficient_balance: "Your Test-Pi balance is too low for this transfer",
        idempotency_conflict: "This transfer request was already used for different details",
      };
      res.status(409).json({
        error: errorByReason[result.reason ?? ""] ?? "Transfer could not be completed",
      });
      return;
    }
    res.json(TransferTestnetWalletResponse.parse({
      groupId: result.group_id,
      transactionId: result.transaction_id,
      amount: parsed.data.amount,
      balance: Number(result.balance),
      status: "completed",
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to transfer Testnet wallet balance");
    res.status(errorStatus(error)).json({ error: "Could not complete Test-Pi transfer" });
  }
});

export default router;