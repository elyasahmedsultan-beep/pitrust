import { Router, type IRouter } from "express";
import {
  AnalyzeAdminDisputeParams,
  AnalyzeAdminDisputeResponse,
  CreateAdminSessionBody,
  CreateAdminSessionResponse,
  GetAdminAccessResponse,
  GetListingAdFeeResponse,
  GetAdminOverviewResponse,
  ListAdminDisputesResponse,
  UpdateAdminListingAdFeeBody,
  UpdateAdminListingAdFeeResponse,
} from "@workspace/api-zod";
import { analyzeDisputeWithGemini } from "../lib/adminGemini";
import {
  adminPasswordConfigurationReady,
  clearAdminPasswordSessionCookie,
  configuredAdminPassword,
  createAdminSessionToken,
  hasAdminPasswordSession,
  requireAdminPasswordSession,
  requireSameOrigin,
  setAdminPasswordSessionCookie,
  verifyAdminPassword,
} from "../lib/adminPasswordAuth";
import { fixedPiUnits } from "../lib/pi";
import { payoutExecutionEnabled } from "../lib/piA2uConfig";
import { supabaseRequest } from "../lib/supabase";
import {
  FeeSettingsUnavailableError,
  getListingAdFees,
  updateListingAdFeeSettings,
} from "../lib/appSettings";

const router: IRouter = Router();
const PAGE_SIZE = 1000;
const HELD_CONTRACT_STATUSES = new Set(["funded", "in_delivery", "disputed"]);
router.use("/admin", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.use(
  ["/admin/overview", "/admin/disputes", "/admin/disputes/:id/analyze"],
  requireAdminPasswordSession,
);

type DisputeRow = {
  id: string;
  contract_id: string;
  reason: string;
  description: string;
  requested_resolution: string;
  resolution: string | null;
  status: "open" | "under_review" | "resolved";
  decision: "release" | "refund" | null;
  created_at: string;
  updated_at: string;
};

type ContractRow = {
  id: string;
  title: string;
  reference: string;
  amount: number | string;
  currency: string;
  status: string;
  buyer_name: string;
  seller_name: string;
  pipeline?: string;
};

type PayoutRow = { contract_id: string; status: string };

async function forEachPage<T>(
  resource: string,
  processPage: (rows: T[]) => void,
): Promise<void> {
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await supabaseRequest<T[]>(resource, {
      headers: {
        "Range-Unit": "items",
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      },
    });
    processPage(rows);
    if (rows.length < PAGE_SIZE) return;
  }
}

function decimalPi(units: bigint): string {
  const whole = units / 100_000_000n;
  const fraction = (units % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function pathParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function scrubUntrustedText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/(?:bearer\s+)[\w.-]+/gi, "[redacted credential]")
    .replace(/\b(?:api[_ -]?key|secret|token|password)\s*[:=]\s*[\w./+=-]+/gi, "[redacted secret]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted contact]")
    .replace(/https?:\/\/\S+/gi, "[redacted link]")
    .replace(/\buser_[A-Za-z0-9_-]+\b/g, "[redacted user id]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[redacted identifier]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted long identifier]")
    .replace(/\b\d{9,}\b/g, "[redacted numeric identifier]")
    .slice(0, maxLength);
}

function safeDeliveryEvidence(value: unknown): Record<string, string | string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const safe: Record<string, string | string[]> = {};
  const allowed = ["carrier", "trackingNumber", "deedReference", "titleReference", "goals"];
  for (const key of allowed) {
    const item = raw[key];
    if (typeof item === "string") safe[key] = scrubUntrustedText(item, 500);
    else if (Array.isArray(item)) {
      safe[key] = item
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 10)
        .map((entry) => scrubUntrustedText(entry, 300));
    }
  }
  return safe;
}

router.get("/listing-ad-fee", async (req, res): Promise<void> => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(GetListingAdFeeResponse.parse(await getListingAdFees()));
  } catch (error) {
    req.log.error({ err: error }, "Could not read listing publication fee");
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: number }).status)
        : 503;
    res.status(status).json({ error: "Listing publication fee is unavailable" });
  }
});

router.patch(
  "/admin/listing-ad-fee",
  requireAdminPasswordSession,
  requireSameOrigin,
  async (req, res): Promise<void> => {
    const body = UpdateAdminListingAdFeeBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    try {
      const updated = await updateListingAdFeeSettings(body.data);
      res.json(UpdateAdminListingAdFeeResponse.parse(updated));
    } catch (error) {
      req.log.error({ err: error }, "Could not update listing publication fee");
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status: number }).status)
          : error instanceof FeeSettingsUnavailableError ? 503 : 500;
      res.status(status).json({ error: "Listing publication fee could not be updated" });
    }
  },
);

router.get("/admin/access", async (req, res): Promise<void> => {
  const adminPasswordAuthenticated = hasAdminPasswordSession(req);
  res.json(GetAdminAccessResponse.parse({
    adminPasswordAuthenticated,
  }));
});

router.post("/admin/session", requireSameOrigin, async (req, res): Promise<void> => {
  const adminPassword = configuredAdminPassword();
  if (!adminPasswordConfigurationReady() || !adminPassword) {
    res.status(503).json({ error: "Admin password authentication is not configured" });
    return;
  }
  const body = CreateAdminSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!verifyAdminPassword(body.data.password, adminPassword)) {
    res.status(401).json({ error: "Invalid admin password" });
    return;
  }
  try {
    if (req.piIframeSessionUserId) {
      res.json(CreateAdminSessionResponse.parse({
        authenticated: true,
        sessionToken: createAdminSessionToken(
          process.env.SESSION_SECRET!,
          adminPassword,
        ),
      }));
      return;
    }
    setAdminPasswordSessionCookie(req, res);
    res.json(CreateAdminSessionResponse.parse({ authenticated: true }));
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not create admin password session");
    res.status(503).json({ error: "Admin password authentication is unavailable" });
  }
});

router.delete("/admin/session", requireSameOrigin, (req, res): void => {
  clearAdminPasswordSessionCookie(req, res);
  res.sendStatus(204);
});

router.get("/admin/overview", async (req, res): Promise<void> => {
  try {
    let openDisputes = 0;
    let resolvedDisputes = 0;
    await forEachPage<{ status: string }>(
      "disputes?select=id,status&order=id.asc",
      (rows) => {
        for (const row of rows) {
          if (row.status === "open" || row.status === "under_review") openDisputes += 1;
          else if (row.status === "resolved") resolvedDisputes += 1;
        }
      },
    );

    let disputedContracts = 0;
    let payoutAttention = 0;
    let heldPiUnits = 0n;
    await Promise.all([
      forEachPage<{ status: string; amount: number | string; currency: string }>(
        "escrow_contracts?select=id,status,amount,currency&order=id.asc",
        (rows) => {
          for (const row of rows) {
            if (row.status === "disputed") disputedContracts += 1;
            if (row.currency === "PI" && HELD_CONTRACT_STATUSES.has(row.status)) {
              const units = fixedPiUnits(row.amount);
              if (units === null) throw new Error("Stored Pi amount has unsupported precision");
              heldPiUnits += units;
            }
          }
        },
      ),
      forEachPage<{ status: string }>(
        "escrow_payout_intents?select=id,status&order=id.asc",
        (rows) => {
          payoutAttention += rows.filter((row) => row.status !== "confirmed").length;
        },
      ),
    ]);

    res.json(GetAdminOverviewResponse.parse({
      openDisputes,
      resolvedDisputes,
      disputedContracts,
      payoutAttention,
      totalEscrowPi: decimalPi(heldPiUnits),
      payoutEnabled: payoutExecutionEnabled(),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not compute admin overview");
    res.status(503).json({ error: "Admin overview is unavailable because live database data could not be read" });
  }
});

router.get("/admin/disputes", async (req, res): Promise<void> => {
  try {
    const disputes = await supabaseRequest<DisputeRow[]>(
      "disputes?select=id,contract_id,reason,description,requested_resolution,resolution,status,decision,created_at,updated_at&order=created_at.desc,id.desc&limit=100",
    );
    if (!disputes.length) {
      res.json(ListAdminDisputesResponse.parse([]));
      return;
    }
    const contractIds = [...new Set(disputes.map((dispute) => dispute.contract_id))];
    const idFilter = `in.(${contractIds.map((id) => `"${id}"`).join(",")})`;
    const [contracts, payouts] = await Promise.all([
      supabaseRequest<ContractRow[]>(
        `escrow_contracts?id=${encodeURIComponent(idFilter)}&select=id,title,reference,amount,currency,status,buyer_name,seller_name`,
      ),
      supabaseRequest<PayoutRow[]>(
        `escrow_payout_intents?contract_id=${encodeURIComponent(idFilter)}&select=contract_id,status`,
      ),
    ]);
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const payoutByContractId = new Map(payouts.map((payout) => [payout.contract_id, payout.status]));

    const result = disputes.map((dispute) => {
      const contract = contractById.get(dispute.contract_id);
      if (!contract) throw new Error(`Contract context missing for dispute ${dispute.id}`);
      return {
        id: dispute.id,
        contractId: dispute.contract_id,
        reason: dispute.reason,
        description: dispute.description,
        requestedResolution: dispute.requested_resolution,
        resolution: dispute.resolution,
        status: dispute.status,
        decision: dispute.decision,
        contractTitle: contract.title,
        contractReference: contract.reference,
        contractAmount: String(contract.amount),
        contractCurrency: contract.currency,
        contractStatus: contract.status,
        buyerName: contract.buyer_name,
        sellerName: contract.seller_name,
        payoutStatus: payoutByContractId.get(dispute.contract_id) ?? null,
        createdAt: dispute.created_at,
        updatedAt: dispute.updated_at,
      };
    });
    res.json(ListAdminDisputesResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error }, "Could not load admin disputes");
    res.status(503).json({ error: "Disputes are unavailable because live database data could not be read" });
  }
});

router.post("/admin/disputes/:id/analyze", requireSameOrigin, async (req, res): Promise<void> => {
  const params = AnalyzeAdminDisputeParams.safeParse({ id: pathParam(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const disputes = await supabaseRequest<DisputeRow[]>(
      `disputes?id=eq.${encodeURIComponent(params.data.id)}&select=id,contract_id,reason,description,requested_resolution,resolution,status,decision,created_at,updated_at&limit=1`,
    );
    const dispute = disputes[0];
    if (!dispute) {
      res.status(404).json({ error: "Dispute not found" });
      return;
    }
    const [contracts, deliveryRows, evidenceRows, payouts] = await Promise.all([
      supabaseRequest<ContractRow[]>(
        `escrow_contracts?id=eq.${encodeURIComponent(dispute.contract_id)}&select=id,title,reference,amount,currency,status,buyer_name,seller_name,pipeline&limit=1`,
      ),
      supabaseRequest<Array<{ evidence: unknown }>>(
        `escrow_delivery_evidence?contract_id=eq.${encodeURIComponent(dispute.contract_id)}&select=evidence&limit=1`,
      ),
      supabaseRequest<Array<{ category: string; content_type: string; size_bytes: number }>>(
        `escrow_evidence?contract_id=eq.${encodeURIComponent(dispute.contract_id)}&select=category,content_type,size_bytes&order=created_at.desc&limit=30`,
      ),
      supabaseRequest<PayoutRow[]>(
        `escrow_payout_intents?contract_id=eq.${encodeURIComponent(dispute.contract_id)}&select=contract_id,status&limit=1`,
      ),
    ]);
    const contract = contracts[0];
    if (!contract) {
      res.status(503).json({ error: "Dispute contract context is unavailable" });
      return;
    }

    const context = JSON.stringify({
      dispute: {
        reason: scrubUntrustedText(dispute.reason, 1000),
        description: scrubUntrustedText(dispute.description, 4000),
        requestedResolution: scrubUntrustedText(dispute.requested_resolution, 1000),
        resolution: dispute.resolution ? scrubUntrustedText(dispute.resolution, 1500) : null,
        status: dispute.status,
        decision: dispute.decision,
      },
      contract: {
        title: scrubUntrustedText(contract.title, 300),
        reference: scrubUntrustedText(contract.reference, 200),
        amount: String(contract.amount),
        currency: contract.currency,
        status: contract.status,
        pipeline: contract.pipeline ?? null,
      },
      deliveryEvidence: safeDeliveryEvidence(deliveryRows[0]?.evidence),
      uploadedEvidence: evidenceRows.map((row) => ({
        category: row.category,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
      })),
      payoutStatus: payouts[0]?.status ?? null,
    });
    try {
      const analysis = await analyzeDisputeWithGemini(context);
      res.json(AnalyzeAdminDisputeResponse.parse(analysis));
    } catch (error) {
      req.log.error({ err: error }, "Gemini dispute analysis failed");
      res.status(502).json({ error: "Gemini dispute analysis is unavailable or returned an invalid response" });
    }
  } catch (error) {
    req.log.error({ err: error }, "Could not load dispute context for advisory analysis");
    res.status(503).json({ error: "Dispute context is unavailable because live database data could not be read" });
  }
});

export default router;