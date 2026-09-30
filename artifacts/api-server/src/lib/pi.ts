import { supabaseRequest } from "./supabase";
import type { ContractRow } from "./escrow";
import { getPaymentFeeSettings } from "./appSettings";
import { findPiProfileByUserId } from "./profileStore";
import { configuredPiNetwork } from "./piA2uConfig.ts";
import { fixedPiUnits } from "./piAmount.ts";
import { piRequest } from "./piPlatformApi.ts";

export { piRequest } from "./piPlatformApi.ts";

export { fixedPiUnits } from "./piAmount.ts";

export type PiPayment = {
  identifier?: string;
  amount?: number | string;
  memo?: string;
  direction?: string;
  network?: string;
  user_uid?: string;
  from_address?: string | null;
  to_address?: string | null;
  metadata?: Record<string, unknown>;
  status?: {
    developer_approved?: boolean;
    transaction_verified?: boolean;
    developer_completed?: boolean;
    cancelled?: boolean;
    user_cancelled?: boolean;
  };
  transaction?: { txid?: string | null; verified?: boolean };
};

export async function linkedPiUid(clerkUserId: string): Promise<string | null> {
  return (await findPiProfileByUserId(clerkUserId))?.piUid ?? null;
}

export async function verifyIncomingPayment(
  paymentId: string,
  contract: ContractRow,
  expectedPiUid: string,
  feeType?: "dispute",
  expectedDisputeFee?: number | string,
  allowCancelled = false,
): Promise<PiPayment> {
  const payment = await piRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`);
  const expectedAmount = feeType === "dispute"
    ? expectedDisputeFee ?? (await getPaymentFeeSettings()).disputeResolutionFeePi
    : contract.amount;
  if (!feeType && contract.currency.toUpperCase() !== "PI") {
    throw Object.assign(new Error("Only PI-denominated contracts can be directly funded with Pi"), { status: 409 });
  }
  const expectedNetwork = configuredPiNetwork() === "mainnet" ? "Pi Network" : null;
  if (
    expectedNetwork === null ||
    payment.identifier !== paymentId ||
    fixedPiUnits(payment.amount ?? "") !== fixedPiUnits(expectedAmount) ||
    payment.direction !== "user_to_app" ||
    payment.network !== expectedNetwork ||
    payment.metadata?.contractId !== contract.id ||
    payment.user_uid !== expectedPiUid ||
    (feeType === "dispute" ? payment.metadata?.feeType !== "dispute" : payment.metadata?.feeType != null) ||
    (!allowCancelled && (payment.status?.cancelled || payment.status?.user_cancelled)) ||
    (payment.status?.developer_completed && !payment.status?.transaction_verified)
  ) {
    throw Object.assign(new Error("Pi payment does not match this contract"), { status: 400 });
  }
  return payment;
}

export async function savePaymentLedger(input: {
  paymentId: string;
  contractId: string;
  userId: string;
  status: string;
  amount: number | string;
  txid?: string | null;
  feeType?: string | null;
}): Promise<void> {
  const rows = await supabaseRequest<Array<{ id: string; status: string }>>("rpc/record_verified_pi_payment", {
    method: "POST",
    body: JSON.stringify({
      p_pi_payment_id: input.paymentId,
      p_contract_id: input.contractId,
      p_user_id: input.userId,
      p_status: input.status,
      p_amount: input.amount,
      p_txid: input.txid ?? null,
      p_fee_type: input.feeType ?? null,
    }),
  });
  if (
    !rows[0] ||
    (rows[0].status !== input.status && !(input.status === "approved" && rows[0].status === "confirmed"))
  ) {
    throw new Error("Payment ledger did not confirm the expected idempotent state transition");
  }
}

export async function expectedDisputeFeeForPayment(
  paymentId: string,
  userId: string,
  configuredAmount?: number | string,
): Promise<number | string> {
  const rows = await supabaseRequest<Array<{ amount: number | string; status: string }>>(
    `escrow_payment_ledger?pi_payment_id=eq.${encodeURIComponent(paymentId)}&user_id=eq.${encodeURIComponent(userId)}&fee_type=eq.dispute&select=amount,status&limit=1`,
  );
  const saved = rows[0];
  if (saved && ["approved", "fee_confirmed"].includes(saved.status)) {
    return saved.amount;
  }
  return configuredAmount ?? (await getPaymentFeeSettings()).disputeResolutionFeePi;
}