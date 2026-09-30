import type { PiPayment } from "./pi.ts";
import { fixedPiUnits, isFlexiblePiAmount } from "./piAmount.ts";
import { getListingAdFees } from "./appSettings.ts";
import { isMissingSupabaseRelation, isMissingSupabaseTable, supabaseRequest } from "./supabase.ts";

export type ListingAdOperation = "publication" | "edit" | "delete";

const LISTING_AD_PAYMENT_MEMOS: Record<ListingAdOperation, string> = {
  publication: "Listing publication fee",
  edit: "Listing edit fee",
  delete: "Listing deletion fee",
};

export type ListingAdPaymentIntentRow = {
  id: string;
  listing_id: string;
  user_id: string;
  pi_uid: string;
  amount: number | string;
  memo: string;
  operation: ListingAdOperation;
  update_payload: Record<string, unknown> | null;
  network: string;
  status: "pending" | "approved" | "confirmed" | "cancelled";
  pi_payment_id: string | null;
  txid: string | null;
};

function databaseError(error: unknown): never {
  if (isMissingSupabaseTable(error) || isMissingSupabaseRelation(error)) {
    throw Object.assign(new Error("Listing publication payment storage is not provisioned"), {
      status: 503,
      code: "LISTING_AD_PAYMENT_STORAGE_MISSING",
    });
  }
  throw error;
}

async function findOpenListingAdPaymentIntent(
  listingId: string,
): Promise<ListingAdPaymentIntentRow | null> {
  try {
    const rows = await supabaseRequest<ListingAdPaymentIntentRow[]>(
      `escrow_listing_ad_payments?listing_id=eq.${encodeURIComponent(listingId)}&status=in.(pending,approved)&select=*&order=created_at.desc&limit=1`,
    );
    return rows[0] ?? null;
  } catch (error) {
    databaseError(error);
  }
}

export async function createListingAdPaymentIntent(input: {
  id: string;
  listingId: string;
  userId: string;
  piUid: string;
  network: string;
  operation: ListingAdOperation;
  updatePayload?: Record<string, unknown>;
}): Promise<ListingAdPaymentIntentRow> {
  let listings: Array<{ id: string; owner_id: string; active: boolean }>;
  try {
    listings = await supabaseRequest<Array<{ id: string; owner_id: string; active: boolean }>>(
      `escrow_listings?id=eq.${encodeURIComponent(input.listingId)}&select=id,owner_id,active&limit=1`,
    );
  } catch (error) {
    databaseError(error);
  }

  const listing = listings[0];
  if (!listing || listing.owner_id !== input.userId) {
    throw Object.assign(new Error("Listing not found"), { status: 404 });
  }
  if (input.operation === "publication" ? listing.active : !listing.active) {
    throw Object.assign(
      new Error(input.operation === "publication" ? "Listing is already published" : "Listing is not active"),
      { status: 409 },
    );
  }
  if (input.operation === "edit" && (!input.updatePayload || !Object.keys(input.updatePayload).length)) {
    throw Object.assign(new Error("Listing changes are required"), { status: 400 });
  }
  if (input.network !== "Pi Network") {
    throw Object.assign(new Error("Pi payment network is unavailable"), { status: 409 });
  }

  const current = await findOpenListingAdPaymentIntent(input.listingId);
  if (current) {
    if (
      current.user_id !== input.userId ||
      current.pi_uid !== input.piUid ||
      current.network !== input.network ||
      current.operation !== input.operation ||
      JSON.stringify(current.update_payload ?? {}) !== JSON.stringify(input.updatePayload ?? {})
    ) {
      throw Object.assign(new Error("An open listing payment is bound to a different identity or network"), { status: 409 });
    }
    if (!isFlexiblePiAmount(current.amount)) {
      throw Object.assign(new Error("Stored listing ad fee is invalid"), { status: 503 });
    }
    return current;
  }

  const fees = await getListingAdFees();
  const amount = input.operation === "publication"
    ? fees.listingAdFeePi
    : input.operation === "edit"
      ? fees.listingEditFeePi
      : fees.listingDeleteFeePi;
  try {
    const inserted = await supabaseRequest<ListingAdPaymentIntentRow[]>("escrow_listing_ad_payments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: input.id,
        listing_id: input.listingId,
        user_id: input.userId,
        pi_uid: input.piUid,
        amount,
        memo: LISTING_AD_PAYMENT_MEMOS[input.operation],
        operation: input.operation,
        update_payload: input.updatePayload ?? null,
        network: input.network,
        status: "pending",
      }),
    });
    if (!inserted[0]) throw new Error("Listing ad payment intent was not persisted");
    return inserted[0];
  } catch (error) {
    const raced = await findOpenListingAdPaymentIntent(input.listingId);
    if (raced) {
      if (
        raced.user_id !== input.userId ||
        raced.pi_uid !== input.piUid ||
        raced.network !== input.network ||
        raced.operation !== input.operation ||
        JSON.stringify(raced.update_payload ?? {}) !== JSON.stringify(input.updatePayload ?? {})
      ) {
        throw Object.assign(new Error("An open listing payment is bound to a different identity or network"), { status: 409 });
      }
      if (!isFlexiblePiAmount(raced.amount)) {
        throw Object.assign(new Error("Stored listing ad fee is invalid"), { status: 503 });
      }
      return raced;
    }
    databaseError(error);
  }
}

export async function getListingAdPaymentIntent(
  intentId: string,
  userId: string,
  piUid: string,
): Promise<ListingAdPaymentIntentRow> {
  try {
    const rows = await supabaseRequest<ListingAdPaymentIntentRow[]>(
      `escrow_listing_ad_payments?id=eq.${encodeURIComponent(intentId)}&user_id=eq.${encodeURIComponent(userId)}&pi_uid=eq.${encodeURIComponent(piUid)}&select=*&limit=1`,
    );
    const intent = rows[0];
    if (!intent) throw Object.assign(new Error("Listing ad payment intent not found"), { status: 404 });
    return intent;
  } catch (error) {
    databaseError(error);
  }
}

export function verifyListingAdPayment(
  paymentId: string,
  payment: PiPayment,
  intent: ListingAdPaymentIntentRow,
  expectedPiUid: string,
  expectedNetwork: string | null,
  allowCancelled = false,
): void {
  const metadata = payment.metadata;
  if (
    expectedNetwork !== intent.network ||
    expectedNetwork !== "Pi Network" ||
    payment.identifier !== paymentId ||
    !isFlexiblePiAmount(intent.amount) ||
    fixedPiUnits(payment.amount ?? "") !== fixedPiUnits(intent.amount) ||
    payment.memo !== intent.memo ||
    payment.direction !== "user_to_app" ||
    payment.network !== intent.network ||
    payment.user_uid !== expectedPiUid ||
    expectedPiUid !== intent.pi_uid ||
    metadata?.type !== "listing_ad" ||
    (metadata?.operation ?? "publication") !== intent.operation ||
    metadata?.listingId !== intent.listing_id ||
    metadata?.intentId !== intent.id ||
    Object.keys(metadata ?? {}).length !== (metadata?.operation === undefined ? 3 : 4) ||
    (!allowCancelled && (payment.status?.cancelled || payment.status?.user_cancelled)) ||
    (payment.status?.developer_completed && !payment.status?.transaction_verified)
  ) {
    throw Object.assign(new Error("Pi payment does not match the listing ad intent"), { status: 400 });
  }
}

export async function recordListingAdPayment(input: {
  intentId: string;
  paymentId: string;
  userId: string;
  piUid: string;
  status: "pending" | "approved" | "confirmed";
  txid?: string;
}): Promise<ListingAdPaymentIntentRow> {
  try {
    const intent = await getListingAdPaymentIntent(input.intentId, input.userId, input.piUid);
    const rows = await supabaseRequest<ListingAdPaymentIntentRow[]>("rpc/record_verified_listing_ad_payment", {
      method: "POST",
      body: JSON.stringify({
        p_intent_id: input.intentId,
        p_payment_id: input.paymentId,
        p_user_id: input.userId,
        p_pi_uid: input.piUid,
        p_amount: Number(intent.amount),
        p_network: intent.network,
        p_status: input.status,
        p_txid: input.txid ?? null,
      }),
    });
    if (!rows[0]) throw new Error("Listing publication payment was not persisted");
    return rows[0];
  } catch (error) {
    databaseError(error);
  }
}

export async function cancelListingAdPaymentIntent(
  intentId: string,
  paymentId: string,
  userId: string,
  piUid: string,
): Promise<void> {
  try {
    const changed = await supabaseRequest<ListingAdPaymentIntentRow[]>(
      `escrow_listing_ad_payments?id=eq.${encodeURIComponent(intentId)}&user_id=eq.${encodeURIComponent(userId)}&pi_uid=eq.${encodeURIComponent(piUid)}&status=in.(pending,approved)&or=(pi_payment_id.is.null,pi_payment_id.eq.${encodeURIComponent(paymentId)})`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          pi_payment_id: paymentId,
          status: "cancelled",
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (changed[0]) return;
    const latest = await getListingAdPaymentIntent(intentId, userId, piUid);
    if (latest.status === "cancelled" && latest.pi_payment_id === paymentId) return;
    throw Object.assign(new Error("Listing publication payment intent could not be cancelled"), { status: 409 });
  } catch (error) {
    databaseError(error);
  }
}