import { StrKey } from "@stellar/stellar-sdk";
import { supabaseRequest } from "./supabase.ts";

export function isValidPiWalletAddress(value: unknown): value is string {
  return typeof value === "string" && StrKey.isValidEd25519PublicKey(value);
}

export function verifiedPiPaymentFromAddress(payment: {
  from_address?: unknown;
  to_address?: unknown;
  status?: {
    developer_approved?: unknown;
    developer_completed?: unknown;
    transaction_verified?: unknown;
    cancelled?: unknown;
    user_cancelled?: unknown;
  };
  transaction?: { verified?: unknown };
}): string | null {
  if (
    payment.status?.developer_approved !== true ||
    payment.status?.developer_completed !== true ||
    payment.status?.transaction_verified !== true ||
    payment.transaction?.verified !== true ||
    payment.status?.cancelled === true ||
    payment.status?.user_cancelled === true ||
    !isValidPiWalletAddress(payment.from_address)
  ) {
    return null;
  }
  return payment.from_address;
}

export async function getPiPayoutIdentity(userId: string): Promise<{
  piUid: string | null;
  walletAddress: string | null;
}> {
  const rows = await supabaseRequest<Array<{
    pi_uid: string | null;
    wallet_address: string | null;
  }>>(
    `escrow_profiles?user_id=eq.${encodeURIComponent(userId)}&select=pi_uid,wallet_address&limit=1`,
  );
  return {
    piUid: rows[0]?.pi_uid ?? null,
    walletAddress: rows[0]?.wallet_address ?? null,
  };
}

export async function payoutWalletForPiUid(piUid: string): Promise<{
  userId: string;
  walletAddress: string | null;
} | null> {
  const rows = await supabaseRequest<Array<{
    user_id: string;
    wallet_address: string | null;
  }>>(
    `escrow_profiles?pi_uid=eq.${encodeURIComponent(piUid)}&select=user_id,wallet_address&limit=1`,
  );
  return rows[0]
    ? { userId: rows[0].user_id, walletAddress: rows[0].wallet_address }
    : null;
}

/**
 * Capture a wallet only after the caller has independently verified payment
 * completion. Conditional updates prevent overwriting a wallet saved by the
 * user or a concurrent payment.
 */
export async function captureVerifiedPiWalletAddressIfEmpty(
  piUid: string,
  candidate: unknown,
): Promise<boolean> {
  if (!piUid.trim() || !isValidPiWalletAddress(candidate)) return false;
  const profile = await payoutWalletForPiUid(piUid);
  if (!profile || profile.walletAddress?.trim()) return false;

  const base = `escrow_profiles?user_id=eq.${encodeURIComponent(profile.userId)}`;
  const updated = await supabaseRequest<Array<{ user_id: string }>>(
    `${base}&wallet_address=is.null&select=user_id`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ wallet_address: candidate }),
    },
  );
  if (updated.length) return true;

  const updatedEmpty = await supabaseRequest<Array<{ user_id: string }>>(
    `${base}&wallet_address=eq.&select=user_id`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ wallet_address: candidate }),
    },
  );
  return updatedEmpty.length > 0;
}

export function hasValidPiPayoutIdentity(identity: {
  piUid: string | null;
  walletAddress: string | null;
}): boolean {
  return Boolean(identity.piUid?.trim() && isValidPiWalletAddress(identity.walletAddress));
}