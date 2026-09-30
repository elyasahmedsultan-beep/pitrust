import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateContractBody,
  CreateDisputeBody,
  CreateDisputeParams,
  CreateDisputeResponse,
  ListNotificationsResponse,
  MarkNotificationReadResponse,
  CancelUnfundedContractParams,
  CancelUnfundedContractResponse,
  GetContractParams,
  GetContractResponse,
  GetDashboardSummaryResponse,
  ListActivityResponse,
  ListContractsResponse,
  ListDisputesParams,
  ListDisputesResponse,
  UpdateContractStatusBody,
  UpdateContractStatusParams,
} from "@workspace/api-zod";
import {
  actionForStatus,
  addActivity,
  findContract,
  isSupabaseError,
  mapActivity,
  mapContract,
  mapDispute,
  releaseDateForStatus,
  type ActivityRow,
  type ContractRow,
  type ContractStatus,
  type DisputeRow,
} from "../lib/escrow";
import { isMissingSupabaseTable, supabaseRequest } from "../lib/supabase";
import { authenticatedUserId, isContractParticipant, requireSession } from "../lib/session";
import { isTestnetWalletHostAllowed } from "../lib/testnetWalletAccess";

const router: IRouter = Router();
router.use("/dashboard", requireSession);
router.use("/contracts", requireSession);
router.use("/activity", requireSession);
router.use("/notifications", requireSession);

function ownedContractsPath(userId: string): string {
  const id = encodeURIComponent(userId);
  return `escrow_contracts?select=*&or=(buyer_id.eq.${id},seller_id.eq.${id})&order=updated_at.desc`;
}

function pathParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

router.post("/contracts/:id/cancel", async (req, res): Promise<void> => {
  const params = CancelUnfundedContractParams.safeParse({ id: pathParam(req.params.id) });
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
    const results = await supabaseRequest<Array<{ success: boolean; reason: string }>>(
      "rpc/cancel_unfunded_escrow_contract",
      {
        method: "POST",
        body: JSON.stringify({ p_contract_id: params.data.id, p_actor_id: actor }),
      },
    );
    const result = results[0];
    if (!result) {
      res.status(503).json({ error: "Cancellation did not return a database result" });
      return;
    }
    if (!result.success) {
      const status = result.reason === "contract_not_found" ? 404 :
        result.reason === "not_participant" ? 403 : 409;
      const messages: Record<string, string> = {
        contract_not_found: "Contract not found",
        not_participant: "Only a contract participant can cancel it",
        contract_not_cancellable: "Only an unfunded contract can be cancelled directly",
        funding_payment_active: "A funding payment is active or has already been confirmed",
      };
      res.status(status).json({ error: messages[result.reason] ?? "Contract could not be cancelled" });
      return;
    }
    res.json(CancelUnfundedContractResponse.parse({
      cancelled: true,
      contractId: params.data.id,
      status: "cancelled",
    }));
  } catch (error) {
    res.status(isSupabaseError(error) ? 503 : 500).json({ error: "Could not cancel this contract" });
  }
});

function errorMessage(error: unknown): string {
  if (isSupabaseError(error)) {
    const details = error.details as { message?: string } | null;
    return details?.message ?? "Supabase request failed";
  }
  return error instanceof Error ? error.message : "Unexpected server error";
}

function statusLabel(status: ContractStatus): string {
  return status.replaceAll("_", " ");
}

function statusActivity(status: ContractStatus) {
  if (status === "completed") {
    return {
      type: "payment_released",
      title: "Payment released",
      description: "Escrow funds were released to the seller.",
      actor: "Escrow system",
      tone: "positive" as const,
    };
  }
  return {
    type: "status_changed",
    title: `Contract ${statusLabel(status)}`,
    description: `The contract moved to ${statusLabel(status)}.`,
    actor: "Workspace member",
    tone: "neutral" as const,
  };
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  try {
    const [contracts, disputes] = await Promise.all([
      supabaseRequest<ContractRow[]>(
        ownedContractsPath(authenticatedUserId(req)!),
      ),
      supabaseRequest<DisputeRow[]>(
        `disputes?select=id,status,contract_id&status=in.(open,under_review)`,
      ),
    ]);
    const visibleIds = new Set(contracts.map((contract) => contract.id));

    const totalValue = contracts.reduce(
      (sum, contract) => sum + Number(contract.amount),
      0,
    );
    const lockedStatuses: ContractStatus[] = [
      "funded",
      "submitted",
      "in_delivery",
      "disputed",
    ];
    const lockedValue = contracts
      .filter((contract) => lockedStatuses.includes(contract.status))
      .reduce((sum, contract) => sum + Number(contract.amount), 0);
    const pendingRelease = contracts
      .filter((contract) => contract.status === "submitted" || contract.status === "in_delivery")
      .reduce((sum, contract) => sum + Number(contract.amount), 0);
    const activeContracts = contracts.filter(
      (contract) =>
        !["completed", "resolved", "refunded", "cancelled"].includes(contract.status),
    ).length;
    const completedContracts = contracts.filter((contract) =>
      ["completed", "resolved"].includes(contract.status),
    ).length;

    const summary = GetDashboardSummaryResponse.parse({
      totalValue,
      lockedValue,
      pendingRelease,
      openDisputes: disputes.filter((dispute) => visibleIds.has(dispute.contract_id)).length,
      activeContracts,
      completionRate:
        contracts.length === 0
          ? 0
          : Math.round((completedContracts / contracts.length) * 100),
    });
    res.json(summary);
  } catch (error) {
    req.log.error({ err: error }, "Failed to load dashboard summary");
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.get("/contracts", async (req, res): Promise<void> => {
  try {
    const rows = await supabaseRequest<ContractRow[]>(
      ownedContractsPath(authenticatedUserId(req)!),
    );
    res.json(ListContractsResponse.parse(rows.map(mapContract)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list escrow contracts");
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.post("/contracts", async (req, res): Promise<void> => {
  const parsed = CreateContractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(409).json({
    error: "Direct contract creation is disabled because the seller is not verifiably identified. Create a listing and start escrow from that seller-owned listing.",
  });
});

router.get("/contracts/:id", async (req, res): Promise<void> => {
  const params = GetContractParams.safeParse({
    id: pathParam(req.params.id),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const contract = await findContract(params.data.id);
    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    if (!isContractParticipant(contract, authenticatedUserId(req)!)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    res.json(GetContractResponse.parse(mapContract(contract)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to load escrow contract");
    res.status(500).json({ error: errorMessage(error) });
  }
});

async function updateContract(
  req: Parameters<Parameters<IRouter["patch"]>[1]>[0],
  res: Parameters<Parameters<IRouter["patch"]>[1]>[1],
  id: string,
  status: ContractStatus,
  note?: string | null,
  expectedStatus?: ContractStatus,
): Promise<void> {
  const now = new Date().toISOString();
  const rows = await supabaseRequest<ContractRow[]>(
    `escrow_contracts?id=eq.${encodeURIComponent(id)}` +
      (expectedStatus ? `&status=eq.${encodeURIComponent(expectedStatus)}` : ""),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status,
        next_action: actionForStatus(status),
        release_date: releaseDateForStatus(status),
        updated_at: now,
      }),
    },
  );

  if (!rows[0]) {
    res.status(expectedStatus ? 409 : 404).json({
      error: expectedStatus
        ? "Contract status changed before the requested transition"
        : "Contract not found",
    });
    return;
  }

  const activity = statusActivity(status);
  try {
    await addActivity(id, {
      ...activity,
      description: note?.trim() || activity.description,
    });
  } catch (error) {
    req.log.warn(
      { contractId: id, errorType: error instanceof Error ? error.name : "unknown" },
      "Contract status changed but its activity entry could not be written",
    );
  }
  res.json(mapContract(rows[0]));
}

router.patch("/contracts/:id/status", async (req, res): Promise<void> => {
  const params = UpdateContractStatusParams.safeParse({
    id: pathParam(req.params.id),
  });
  const body = UpdateContractStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    const error = !params.success
      ? params.error.message
      : !body.success
        ? body.error.message
        : "Invalid request";
    res.status(400).json({
      error,
    });
    return;
  }

  res.status(409).json({ error: "Contract status is controlled by verified payment and delivery events" });
});

router.post("/contracts/:id/fund", async (req, res): Promise<void> => {
  if (!isTestnetWalletHostAllowed(req.hostname)) {
    res.status(404).json({ error: "Internal Testnet escrow funding is unavailable on this host" });
    return;
  }
  const params = GetContractParams.safeParse({ id: pathParam(req.params.id) });
  const actor = authenticatedUserId(req);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
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
    }>>("rpc/fund_testnet_escrow_from_wallet", {
      method: "POST",
      body: JSON.stringify({
        p_contract_id: params.data.id,
        p_user_id: actor,
      }),
    });
    const result = rows[0];
    if (!result) {
      res.status(503).json({ error: "Testnet escrow funding did not return a result" });
      return;
    }
    if (!result.success) {
      const status = result.reason === "contract_not_found" ? 404 : 409;
      const message = result.reason === "insufficient_balance"
        ? "Insufficient Test-Pi balance to fund this escrow"
        : result.reason === "contract_not_fundable"
          ? "This escrow is not accepting Testnet wallet funding"
          : "Could not fund this escrow from the Testnet wallet";
      res.status(status).json({ error: message });
      return;
    }
    const contract = await findContract(params.data.id);
    if (!contract) {
      res.status(503).json({ error: "Escrow was funded but its current state could not be loaded" });
      return;
    }
    res.json(GetContractResponse.parse(mapContract(contract)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to fund escrow from Testnet wallet");
    const status = isMissingSupabaseTable(error)
      ? 503
      : typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: number }).status)
        : 500;
    res.status(status).json({ error: "Could not fund escrow from the Testnet wallet" });
  }
});

router.post("/contracts/:id/confirm-delivery", async (req, res): Promise<void> => {
  const id = pathParam(req.params.id);
  try {
    const contract = await findContract(id);
    if (!contract || contract.buyer_id !== authenticatedUserId(req) || !contract.seller_id) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    if (contract.status !== "submitted") {
      res.status(409).json({ error: "Only a seller-submitted delivery can be confirmed" });
      return;
    }
    const evidence = await supabaseRequest<Array<{ id: string }>>(
      `escrow_delivery_evidence?contract_id=eq.${encodeURIComponent(id)}` +
        `&submitter_id=eq.${encodeURIComponent(contract.seller_id)}&select=id&limit=1`,
    );
    if (!evidence.length) {
      res.status(409).json({ error: "Seller delivery evidence must be validated before confirming delivery" });
      return;
    }
    await updateContract(req, res, id, "in_delivery", undefined, "submitted");
  } catch (error) {
    req.log.error({ err: error }, "Failed to confirm delivery");
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.get("/contracts/:id/disputes", async (req, res): Promise<void> => {
  const params = ListDisputesParams.safeParse({
    id: pathParam(req.params.id),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const contract = await findContract(params.data.id);
    if (!contract || !isContractParticipant(contract, authenticatedUserId(req)!)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const rows = await supabaseRequest<DisputeRow[]>(
      `disputes?contract_id=eq.${encodeURIComponent(params.data.id)}&select=*&order=created_at.desc`,
    );
    res.json(ListDisputesResponse.parse(rows.map(mapDispute)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list contract disputes");
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.post("/contracts/:id/disputes", async (req, res): Promise<void> => {
  const params = CreateDisputeParams.safeParse({
    id: pathParam(req.params.id),
  });
  const body = CreateDisputeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    const error = !params.success
      ? params.error.message
      : !body.success
        ? body.error.message
        : "Invalid request";
    res.status(400).json({
      error,
    });
    return;
  }

  try {
    const contract = await findContract(params.data.id);
    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    if (!isContractParticipant(contract, authenticatedUserId(req)!)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const confirmedDisputeFee = await supabaseRequest<Array<{ pi_payment_id: string }>>(
      `escrow_payment_ledger?contract_id=eq.${encodeURIComponent(params.data.id)}&user_id=eq.${encodeURIComponent(authenticatedUserId(req)!)}&fee_type=eq.dispute&status=eq.fee_confirmed&consumed_at=is.null&select=pi_payment_id&limit=1`,
    );
    if (!confirmedDisputeFee.length) {
      res.status(402).json({
        error: "A separately Pi-confirmed dispute fee is required; no fee was recorded",
      });
      return;
    }

    const disputeId = randomUUID();
    const created = await supabaseRequest<Array<{ dispute_id: string }>>(
      "rpc/create_dispute_with_consumed_fee",
      {
        method: "POST",
        body: JSON.stringify({
          p_dispute_id: disputeId,
          p_contract_id: params.data.id,
          p_user_id: authenticatedUserId(req)!,
          p_pi_payment_id: confirmedDisputeFee[0].pi_payment_id,
          p_reason: body.data.reason,
          p_description: body.data.description,
          p_requested_resolution: body.data.requestedResolution,
        }),
      },
    );
    if (!created[0]) {
      res.status(409).json({ error: "Dispute fee could not be consumed atomically" });
      return;
    }
    const dispute = await supabaseRequest<DisputeRow[]>(
      `disputes?id=eq.${encodeURIComponent(disputeId)}&select=*&limit=1`,
    );
    await addActivity(params.data.id, {
      type: "dispute_opened",
      title: "Dispute opened",
      description: body.data.reason,
      actor: "Workspace member",
      tone: "danger",
    });
    res.status(201).json(
      CreateDisputeResponse.parse(
        mapDispute(dispute[0]),
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Failed to create dispute");
    if (typeof error === "object" && error !== null && "status" in error &&
        Number((error as { status: unknown }).status) === 503) {
      res.status(503).json({ error: "Current payment settings are unavailable; no dispute was opened" });
      return;
    }
    if (isSupabaseError(error) && [400, 409].includes(error.status)) {
      res.status(409).json({ error: "The contract, dispute fee, or dispute eligibility changed before the fee could be consumed" });
      return;
    }
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.get("/activity", async (req, res): Promise<void> => {
  try {
    let rows: ActivityRow[];
    try {
      const contracts = await supabaseRequest<ContractRow[]>(
        ownedContractsPath(authenticatedUserId(req)!),
      );
      rows = contracts.length === 0
        ? []
        : await supabaseRequest<ActivityRow[]>(
            `escrow_activity?select=*&contract_id=in.(${encodeURIComponent(contracts.map((row) => row.id).join(","))})&order=created_at.desc&limit=50`,
          );
    } catch (error) {
      if (!isMissingSupabaseTable(error)) {
        throw error;
      }
        req.log.warn({ reason: "missing_activity_table" }, "Escrow activity is not provisioned; returning an empty list");
      rows = [];
    }
    res.json(ListActivityResponse.parse(rows.map(mapActivity)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list activity");
    res.status(500).json({ error: errorMessage(error) });
  }
});

type NotificationRow = {
  id: string;
  contract_id: string;
  type: string;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

function mapNotification(row: NotificationRow) {
  return {
    id: row.id,
    contractId: row.contract_id,
    type: row.type,
    title: row.title,
    message: row.message,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

router.get("/notifications", async (req, res): Promise<void> => {
  const actor = authenticatedUserId(req);
  if (!actor) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const rows = await supabaseRequest<NotificationRow[]>(
      `escrow_notifications?user_id=eq.${encodeURIComponent(actor)}&select=id,contract_id,type,title,message,created_at,read_at&order=created_at.desc&limit=50`,
    );
    res.json(ListNotificationsResponse.parse(rows.map(mapNotification)));
  } catch (error) {
    if (isMissingSupabaseTable(error)) {
      res.status(503).json({
        error: "In-app notification storage is not installed; apply the pending escrow notification migration",
      });
      return;
    }
    req.log.error({ err: error }, "Failed to list in-app notifications");
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const actor = authenticatedUserId(req);
  if (!actor) { res.status(401).json({ error: "Authentication required" }); return; }
  const id = pathParam(req.params.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "A valid notification ID is required" });
    return;
  }
  try {
    const rows = await supabaseRequest<NotificationRow[]>(
      `escrow_notifications?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(actor)}&select=id,contract_id,type,title,message,created_at,read_at`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ read_at: new Date().toISOString() }),
      },
    );
    if (!rows[0]) { res.status(404).json({ error: "Notification not found" }); return; }
    res.json(MarkNotificationReadResponse.parse(mapNotification(rows[0])));
  } catch (error) {
    req.log.error({ err: error }, "Failed to mark notification as read");
    res.status(500).json({ error: errorMessage(error) });
  }
});

export default router;