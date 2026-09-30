export type AutoReleaseCandidate = {
  intent_id: string;
  contract_id: string;
  amount: number | string;
  platform_fee: number | string;
  inviter_reward: number | string;
  seller_amount: number | string;
  recipient_uid: string;
  recipient_wallet_address: string;
  inviter_id: string | null;
  payment_id: string | null;
  txid: string | null;
  network: string;
  purpose: "standard_release";
  dispute_id: null;
  seller_id: string;
};

type AutoReleaseScanOptions = {
  shouldStop?: () => boolean;
  maxCandidates?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isAmount(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAutoReleaseCandidate(value: unknown): value is AutoReleaseCandidate {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.intent_id) &&
    isNonEmptyString(value.contract_id) &&
    isAmount(value.amount) &&
    isAmount(value.platform_fee) &&
    isAmount(value.inviter_reward) &&
    isAmount(value.seller_amount) &&
    isNonEmptyString(value.recipient_uid) &&
    isNonEmptyString(value.recipient_wallet_address) &&
    isNullableString(value.inviter_id) &&
    isNullableString(value.payment_id) &&
    isNullableString(value.txid) &&
    value.network === "Pi Network" &&
    value.purpose === "standard_release" &&
    value.dispute_id === null &&
    isNonEmptyString(value.seller_id);
}

export function firstAutoReleaseCandidate(response: unknown): AutoReleaseCandidate | null {
  if (response == null) return null;
  if (!Array.isArray(response)) {
    throw new Error("Automatic escrow release RPC returned a non-array response");
  }

  for (const row of response) {
    if (row == null) continue;
    if (!isAutoReleaseCandidate(row)) {
      throw new Error("Automatic escrow release RPC returned an incomplete candidate");
    }
    return row;
  }

  return null;
}

export async function scanAutoReleaseCandidates(
  claimNext: () => Promise<unknown>,
  executeCandidate: (candidate: AutoReleaseCandidate) => Promise<void>,
  options: AutoReleaseScanOptions = {},
): Promise<void> {
  const maxCandidates = options.maxCandidates ?? 12;
  const shouldStop = options.shouldStop ?? (() => false);

  for (let count = 0; count < maxCandidates && !shouldStop(); count += 1) {
    const candidate = firstAutoReleaseCandidate(await claimNext());
    if (!candidate) return;
    await executeCandidate(candidate);
  }
}