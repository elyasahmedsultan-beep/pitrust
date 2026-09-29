import { fixedPiUnits, type PiPayment } from "./pi.ts";
import { isMissingSupabaseRelation, supabaseRequest } from "./supabase.ts";
import {
  ESCROW_SERVICE_DEPOSIT,
  verifyEscrowServiceDepositPayment,
} from "./escrowServiceDepositRules.ts";
import type { EscrowServiceDepositPayment } from "./escrowServiceDepositRules.ts";

export { ESCROW_SERVICE_DEPOSIT, verifyEscrowServiceDepositPayment };
export type { EscrowServiceDepositPayment };

export type EscrowServiceDepositRecord = {
  paymentId: string;
  productName: string;
  description: string;
  amount: number;
  memo: string;
  metadata: { type: "escrow" };
  network: "Pi Network";
  status: "pending" | "approved" | "confirmed";
  txid: string | null;
  createdAt: string;
};

type EscrowServiceDepositRow = {
  pi_payment_id: string;
  user_id: string;
  pi_uid: string;
  product_name: string;
  description: string;
  amount: number | string;
  memo: string;
  metadata: { type?: unknown };
  network: string;
  status: EscrowServiceDepositRecord["status"];
  txid: string | null;
  created_at: string;
};

function databaseError(error: unknown): never {
  if (isMissingSupabaseRelation(error)) {
    throw Object.assign(new Error("Escrow service deposit storage is not provisioned"), { status: 503 });
  }
  throw error;
}

function toRecord(row: EscrowServiceDepositRow): EscrowServiceDepositRecord {
  return {
    paymentId: row.pi_payment_id,
    productName: row.product_name,
    description: row.description,
    amount: Number(row.amount),
    memo: row.memo,
    metadata: { type: "escrow" },
    network: "Pi Network",
    status: row.status,
    txid: row.txid,
    createdAt: row.created_at,
  };
}

function assertOwnedDeposit(
  row: EscrowServiceDepositRow,
  userId: string,
  piUid: string,
): void {
  if (
    row.user_id !== userId ||
    row.pi_uid !== piUid ||
    row.product_name !== ESCROW_SERVICE_DEPOSIT.productName ||
    row.description !== ESCROW_SERVICE_DEPOSIT.description ||
    fixedPiUnits(row.amount) !== fixedPiUnits(ESCROW_SERVICE_DEPOSIT.amount) ||
    row.memo !== ESCROW_SERVICE_DEPOSIT.memo ||
    row.metadata?.type !== ESCROW_SERVICE_DEPOSIT.metadata.type ||
    row.network !== "Pi Network"
  ) {
    throw Object.assign(new Error("Pi payment is already bound to a different escrow deposit"), { status: 409 });
  }
}

async function findDepositByPaymentId(paymentId: string): Promise<EscrowServiceDepositRow | null> {
  try {
    const rows = await supabaseRequest<EscrowServiceDepositRow[]>(
      `escrow_service_deposits?pi_payment_id=eq.${encodeURIComponent(paymentId)}&select=*&limit=1`,
    );
    return rows[0] ?? null;
  } catch (error) {
    databaseError(error);
  }
}

export async function listEscrowServiceDeposits(userId: string): Promise<EscrowServiceDepositRecord[]> {
  try {
    const rows = await supabaseRequest<EscrowServiceDepositRow[]>(
      `escrow_service_deposits?user_id=eq.${encodeURIComponent(userId)}&select=pi_payment_id,user_id,pi_uid,product_name,description,amount,memo,metadata,network,status,txid,created_at&order=created_at.desc&limit=10`,
    );
    return rows.map(toRecord);
  } catch (error) {
    databaseError(error);
  }
}

export async function saveEscrowServiceDeposit(input: {
  paymentId: string;
  userId: string;
  piUid: string;
  status: EscrowServiceDepositRecord["status"];
  txid?: string;
}): Promise<EscrowServiceDepositRecord> {
  const existing = await findDepositByPaymentId(input.paymentId);
  if (existing) {
    assertOwnedDeposit(existing, input.userId, input.piUid);
    if (existing.txid && input.txid && existing.txid !== input.txid) {
      throw Object.assign(new Error("Pi payment is already bound to a different transaction"), { status: 409 });
    }
    const statusOrder = { pending: 0, approved: 1, confirmed: 2 } as const;
    const status = statusOrder[existing.status] >= statusOrder[input.status] ? existing.status : input.status;
    const txid = existing.txid ?? input.txid ?? null;
    if (status === existing.status && txid === existing.txid) return toRecord(existing);
    try {
      const updated = await supabaseRequest<EscrowServiceDepositRow[]>(
        `escrow_service_deposits?pi_payment_id=eq.${encodeURIComponent(input.paymentId)}&user_id=eq.${encodeURIComponent(input.userId)}${status === "confirmed" ? "" : "&status=neq.confirmed"}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ status, txid, updated_at: new Date().toISOString() }),
        },
      );
      if (!updated[0]) {
        const latest = await findDepositByPaymentId(input.paymentId);
        if (latest) {
          assertOwnedDeposit(latest, input.userId, input.piUid);
          if (
            statusOrder[latest.status] >= statusOrder[input.status] &&
            (!input.txid || latest.txid === input.txid)
          ) return toRecord(latest);
        }
        throw Object.assign(new Error("Escrow service deposit state could not be updated"), { status: 409 });
      }
      return toRecord(updated[0]);
    } catch (error) {
      databaseError(error);
    }
  }

  const row = {
    pi_payment_id: input.paymentId,
    user_id: input.userId,
    pi_uid: input.piUid,
    product_name: ESCROW_SERVICE_DEPOSIT.productName,
    description: ESCROW_SERVICE_DEPOSIT.description,
    amount: ESCROW_SERVICE_DEPOSIT.amount,
    memo: ESCROW_SERVICE_DEPOSIT.memo,
    metadata: ESCROW_SERVICE_DEPOSIT.metadata,
    network: "Pi Network",
    status: input.status,
    txid: input.txid ?? null,
  };
  try {
    const inserted = await supabaseRequest<EscrowServiceDepositRow[]>("escrow_service_deposits", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!inserted[0]) throw new Error("Escrow service deposit was not persisted");
    return toRecord(inserted[0]);
  } catch (error) {
    const raced = await findDepositByPaymentId(input.paymentId);
    if (raced) {
      assertOwnedDeposit(raced, input.userId, input.piUid);
      return saveEscrowServiceDeposit(input);
    }
    databaseError(error);
  }
}