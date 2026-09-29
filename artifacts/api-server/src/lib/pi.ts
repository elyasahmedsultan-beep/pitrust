import { supabaseRequest } from "./supabase";
import type { ContractRow } from "./escrow";
import { getPaymentFeeSettings } from "./appSettings";
import { findPiProfileByUserId } from "./profileStore";
import { configuredPiApiKey, configuredPiNetwork } from "./piA2uConfig.ts";

const PI_API = "https://api.minepi.com/v2";

export type PiPayment = {
  identifier?: string;
  amount?: number | string;
  memo?: string;
  direction?: string;
  network?: string;
  user_uid?: string;
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

export function fixedPiUnits(value: number | string): bigint | null {
  const raw = String(value);
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return null;
  const exponent = Number(match[3] ?? "0");
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null;
  let digits = `${match[1]}${match[2] ?? ""}`.replace(/^0+(?=\d)/, "");
  let decimalPlaces = (match[2] ?? "").length - exponent;
  if (decimalPlaces > 8) {
    const excess = decimalPlaces - 8;
    if (!digits.endsWith("0".repeat(excess))) return null;
    digits = digits.slice(0, -excess);
    decimalPlaces = 8;
  }
  if (decimalPlaces < 0) {
    digits += "0".repeat(-decimalPlaces);
    decimalPlaces = 0;
  }
  return BigInt(digits || "0") * 10n ** BigInt(8 - decimalPlaces);
}

export async function piRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = configuredPiApiKey();
  if (!key) {
    throw Object.assign(new Error("Pi API credentials for the selected network are not configured"), { status: 503 });
  }
  const response = await fetch(`${PI_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error("Pi API request failed"), {
      status: response.status >= 500 ? 502 : response.status,
      details: payload,
    });
  }
  return payload as T;
}

export function piNetworkApiConfigured(): boolean {
  return Boolean(process.env.PI_NETWORK_API_KEY?.trim());
}

export async function piNetworkRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (configuredPiNetwork() !== "mainnet") {
    throw Object.assign(new Error("Escrow service deposits are available on Pi Mainnet only"), { status: 409 });
  }
  const key = process.env.PI_NETWORK_API_KEY?.trim();
  if (!key) {
    throw Object.assign(new Error("PI_NETWORK_API_KEY is not configured"), { status: 503 });
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Key ${key}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${PI_API}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error("Pi Network payment request failed"), {
      status: response.status >= 500 ? 502 : response.status,
      details: payload,
    });
  }
  return payload as T;
}

export async function verifyIncomingPayment(
  paymentId: string,
  contract: ContractRow,
  expectedPiUid: string,
  feeType?: "dispute",
  expectedDisputeFee?: number | string,
): Promise<PiPayment> {
  const payment = await piRequest<PiPayment>(`/payments/${encodeURIComponent(paymentId)}`);
  const expectedAmount = feeType === "dispute"
    ? expectedDisputeFee ?? (await getPaymentFeeSettings()).disputeResolutionFeePi
    : contract.amount;
  if (!feeType && contract.currency.toUpperCase() !== "PI") {
    throw Object.assign(new Error("Only PI-denominated contracts can be directly funded with Pi"), { status: 409 });
  }
  const configuredNetwork = process.env.PI_NETWORK ?? "testnet";
  const expectedNetwork =
    configuredNetwork === "mainnet" ? "Pi Network" :
    configuredNetwork === "testnet" ? "Pi Testnet" : null;
  if (
    expectedNetwork === null ||
    payment.identifier !== paymentId ||
    fixedPiUnits(payment.amount ?? "") !== fixedPiUnits(expectedAmount) ||
    payment.direction !== "user_to_app" ||
    payment.network !== expectedNetwork ||
    payment.metadata?.contractId !== contract.id ||
    payment.user_uid !== expectedPiUid ||
    (feeType === "dispute" ? payment.metadata?.feeType !== "dispute" : payment.metadata?.feeType != null) ||
    payment.status?.cancelled ||
    payment.status?.user_cancelled ||
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
  if (!rows[0] || rows[0].status !== input.status) {
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