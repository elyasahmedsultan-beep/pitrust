import { randomUUID } from "node:crypto";
import {
  isMissingSupabaseTable,
  supabaseRequest,
  type SupabaseRequestError,
} from "./supabase";
import { logger } from "./logger";

export type ContractStatus =
  | "draft"
  | "awaiting_funding"
  | "funded"
  | "submitted"
  | "in_delivery"
  | "completed"
  | "disputed"
  | "resolved"
  | "refunded"
  | "cancelled";

export type DisputeStatus = "open" | "under_review" | "resolved";

export type ContractRow = {
  id: string;
  buyer_id?: string | null;
  seller_id?: string | null;
  pipeline?: "digital" | "shippable" | "local_property" | "custom_terms";
  metadata?: Record<string, unknown>;
  title: string;
  reference: string;
  buyer_name: string;
  seller_name: string;
  amount: number | string;
  currency: string;
  status: ContractStatus;
  due_date: string;
  payment_method: string;
  next_action: string | null;
  dispute_count: number;
  release_date: string | null;
  submitted_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityRow = {
  id: string;
  contract_id: string;
  type: string;
  title: string;
  description: string;
  actor: string;
  tone: "positive" | "neutral" | "warning" | "danger";
  created_at: string;
};

export type DisputeRow = {
  id: string;
  contract_id: string;
  reason: string;
  description?: string | null;
  status: DisputeStatus;
  requested_resolution?: string | null;
  resolution?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export function mapContract(row: ContractRow) {
  return {
    id: row.id,
    buyerId: row.buyer_id ?? null,
    sellerId: row.seller_id ?? null,
    pipeline: row.pipeline ?? "custom_terms",
    metadata: row.metadata ?? {},
    title: row.title,
    reference: row.reference,
    buyerName: row.buyer_name,
    sellerName: row.seller_name,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    dueDate: row.due_date,
    paymentMethod: row.payment_method,
    nextAction: row.next_action,
    disputeCount: Number(row.dispute_count ?? 0),
    releaseDate: row.release_date,
    submittedAt: row.submitted_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapActivity(row: ActivityRow) {
  return {
    id: row.id,
    contractId: row.contract_id,
    type: row.type,
    title: row.title,
    description: row.description ?? "",
    actor: row.actor,
    tone: row.tone,
    createdAt: row.created_at,
  };
}

export function mapDispute(row: DisputeRow) {
  return {
    id: row.id,
    contractId: row.contract_id,
    reason: row.reason,
    description: row.description,
    status: row.status,
    requestedResolution: row.requested_resolution ?? "",
    resolution: row.resolution ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export async function findContract(id: string): Promise<ContractRow | null> {
  const rows = await supabaseRequest<ContractRow[]>(
    `escrow_contracts?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
  );
  return rows[0] ?? null;
}

export async function addActivity(
  contractId: string,
  input: Omit<ActivityRow, "id" | "contract_id" | "created_at">,
): Promise<void> {
  try {
    await supabaseRequest("escrow_activity", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: randomUUID(),
        contract_id: contractId,
        ...input,
      }),
    });
  } catch (error) {
    if (isMissingSupabaseTable(error)) {
      logger.warn(
        { contractId },
        "Activity table is not provisioned; continuing without activity history",
      );
      return;
    }
    throw error;
  }
}

export function actionForStatus(status: ContractStatus): string | null {
  switch (status) {
    case "draft":
    case "awaiting_funding":
      return "Fund escrow";
    case "funded":
      return "Mark delivery in progress";
    case "submitted":
      return "Review submitted delivery";
    case "in_delivery":
      return "Confirm delivery";
    case "completed":
      return null;
    case "disputed":
      return "Review open dispute";
    case "resolved":
    case "refunded":
      return null;
    case "cancelled":
      return null;
  }
}

export function releaseDateForStatus(status: ContractStatus): string | null {
  return status === "completed" ? new Date().toISOString() : null;
}

export function isSupabaseError(
  error: unknown,
): error is SupabaseRequestError {
  return error instanceof Error && error.name === "SupabaseRequestError";
}