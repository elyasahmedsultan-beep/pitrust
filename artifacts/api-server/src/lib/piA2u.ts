import PiNetwork from "pi-backend";
import { fixedPiUnits } from "./piAmount.ts";
import {
  configuredPiApiKey,
  configuredPiNetwork,
  configuredWalletPrivateSeed,
} from "./piA2uConfig.ts";
import { isValidPiWalletAddress } from "./piWallet.ts";

export {
  payoutExecutionEnabled,
  productionPayoutEnabled,
} from "./piA2uConfig.ts";

export type PiA2UPayment = Awaited<ReturnType<PiNetwork["getPayment"]>>;

export type PayoutSnapshot = {
  id: string;
  contract_id: string;
  amount: number | string;
  platform_fee: number | string;
  inviter_reward: number | string;
  seller_amount: number | string;
  recipient_address: string;
  recipient_wallet_address: string | null;
  inviter_id: string | null;
  pi_payment_id: string | null;
  txid: string | null;
  network: string;
  purpose?: "standard_release" | "arbitration_release" | "arbitration_refund";
  dispute_id?: string | null;
};

export function currentPiNetwork(): "Pi Network" | null {
  return configuredPiNetwork() === "mainnet" ? "Pi Network" : null;
}

export function createPiA2USdk(): PiNetwork {
  const apiKey = configuredPiApiKey();
  const walletPrivateSeed = configuredWalletPrivateSeed();
  if (!apiKey || !walletPrivateSeed) {
    throw new Error("Pi Mainnet A2U credentials are not configured");
  }
  return new PiNetwork(apiKey, walletPrivateSeed);
}

export function payoutPaymentMetadata(payout: PayoutSnapshot): Record<string, unknown> {
  const purpose = payout.purpose ?? "standard_release";
  const arbitration = purpose !== "standard_release";
  return {
    type: arbitration ? "escrow_arbitration_payout" : "escrow_release",
    escrowContractId: payout.contract_id,
    escrowPayoutIntentId: payout.id,
    ...(arbitration ? {
      purpose,
      disputeId: payout.dispute_id,
    } : {}),
    grossAmountPi: Number(payout.amount),
    platformFeePi: Number(payout.platform_fee),
    inviterRewardPi: Number(payout.inviter_reward),
    network: payout.network,
    version: 1,
  };
}

export function matchesPayoutPayment(
  payment: PiA2UPayment | null | undefined,
  payout: PayoutSnapshot,
): boolean {
  if (!payment || typeof payment !== "object") return false;
  const status = payment.status;
  if (!status || typeof status !== "object") return false;

  const metadata = payment.metadata as Record<string, unknown> | null;
  const purpose = payout.purpose ?? "standard_release";
  const arbitration = purpose !== "standard_release";
  return Boolean(
    payment.identifier &&
    payout.network === "Pi Network" &&
    (!payout.pi_payment_id || payment.identifier === payout.pi_payment_id) &&
    payment.user_uid === payout.recipient_address &&
    typeof payout.recipient_wallet_address === "string" &&
    isValidPiWalletAddress(payout.recipient_wallet_address) &&
    payment.to_address === payout.recipient_wallet_address &&
    payment.direction === "app_to_user" &&
    payment.network === payout.network &&
    fixedPiUnits(payment.amount) !== null &&
    fixedPiUnits(payment.amount) === fixedPiUnits(payout.seller_amount) &&
    metadata?.type === (arbitration ? "escrow_arbitration_payout" : "escrow_release") &&
    metadata.escrowContractId === payout.contract_id &&
    metadata.escrowPayoutIntentId === payout.id &&
    (!arbitration || (
      metadata.purpose === purpose &&
      metadata.disputeId === payout.dispute_id &&
      typeof payout.dispute_id === "string" &&
      payout.dispute_id.length > 0
    )) &&
    metadata.network === payout.network &&
    metadata.version === 1 &&
    fixedPiUnits(String(metadata.grossAmountPi ?? "")) === fixedPiUnits(payout.amount) &&
    fixedPiUnits(String(metadata.platformFeePi ?? "")) === fixedPiUnits(payout.platform_fee) &&
    fixedPiUnits(String(metadata.inviterRewardPi ?? "")) === fixedPiUnits(payout.inviter_reward) &&
    status.cancelled === false &&
    status.user_cancelled === false
  );
}

export function payoutPaymentIsCompleted(
  payment: PiA2UPayment | null | undefined,
  expectedTxid: string,
): boolean {
  const status = payment?.status;
  return status?.developer_approved === true &&
    status?.transaction_verified === true &&
    status?.developer_completed === true &&
    payment?.transaction?.verified === true &&
    payment?.transaction?.txid === expectedTxid;
}

export function payoutAmountAsNumber(value: number | string): number {
  const units = fixedPiUnits(value);
  if (units === null) throw new Error("Payout amount has unsupported decimal precision");
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || fixedPiUnits(numeric) !== units) {
    throw new Error("Payout amount cannot be safely represented by the Pi SDK");
  }
  return numeric;
}