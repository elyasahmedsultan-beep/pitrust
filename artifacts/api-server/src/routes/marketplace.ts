import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  CreateListingBody,
  CreateListingResponse,
  CreateListingContractBody,
  CreateListingContractParams,
  CreateListingContractResponse,
  GetMarketStatsResponse,
  GetMyListingsResponse,
  GetProfileResponse,
  GetReferralSummaryResponse,
  ListSignaturesResponse,
  ListContractMessagesResponse,
  ChatLanguage,
  SendContractMessageBody,
  SignContractBody,
  SubmitDeliveryBody,
  SearchListingsResponse,
  SendContractMessageResponse,
  SignContractResponse,
  SubmitDeliveryResponse,
  UpdateProfileBody,
} from "@workspace/api-zod";
import { actionForStatus, findContract, mapContract, type ContractRow } from "../lib/escrow";
import { authenticatedUserId, isContractParticipant, requireSession } from "../lib/session";
import { isMissingSupabaseRelation, supabaseRequest } from "../lib/supabase";
import { fixedPiUnits } from "../lib/pi";
import { listEvidence } from "../lib/escrowEvidence";
import { isTestnetWalletHostAllowed } from "../lib/testnetWalletAccess";
import { translateChatBatch, translationErrorDetails } from "../lib/messageTranslation";
import {
  getPiPayoutIdentity,
  hasValidPiPayoutIdentity,
  isValidPiWalletAddress,
} from "../lib/piWallet";

const router: IRouter = Router();
const pipelines = ["digital", "shippable", "local_property", "custom_terms"] as const;
const contractTranslationRetryAfter = new Map<string, number>();
const CONTRACT_TRANSLATION_RETRY_DELAY_MS = 60_000;
let contractTranslationCacheRetryAfter = 0;
router.use("/profile", requireSession);
router.use("/referrals", requireSession);

function userId(req: Request): string | null {
  return authenticatedUserId(req);
}

async function getOrCreateProfileRow(actor: string): Promise<Record<string, unknown>> {
  const profilePath =
    `escrow_profiles?user_id=eq.${encodeURIComponent(actor)}&select=*&limit=1`;
  const readProfile = async () =>
    (await supabaseRequest<Record<string, unknown>[]>(profilePath))[0];

  const existing = await readProfile();
  if (existing) return existing;

  await supabaseRequest<unknown>("escrow_profiles?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: actor,
      display_name: "Member",
      referral_code: randomUUID().replaceAll("-", "").slice(0, 12),
    }),
  });

  const created = await readProfile();
  if (!created) {
    throw Object.assign(new Error("User profile could not be initialized"), {
      status: 503,
    });
  }
  return created;
}

function errorStatus(error: unknown): number {
  if (isMissingSupabaseRelation(error)) return 503;
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: number }).status)
    : 500;
}

function listingOut(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    amount: Number(row.amount),
    currency: row.currency,
    pipeline: row.pipeline,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function ownedListingOut(row: Record<string, unknown>) {
  return {
    ...listingOut(row),
    active: row.active === true,
  };
}

router.get("/listings/mine", requireSession, async (req, res): Promise<void> => {
  const actor = userId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const rows = await supabaseRequest<Record<string, unknown>[]>(
      `escrow_listings?owner_id=eq.${encodeURIComponent(actor)}&select=id,title,description,amount,currency,pipeline,metadata,active,created_at&order=created_at.desc&limit=100`,
    );
    res.json(GetMyListingsResponse.parse(rows.map(ownedListingOut)));
  } catch (error) {
    res.status(errorStatus(error)).json({ error: "Could not load your listings" });
  }
});

router.get("/listings", async (req, res): Promise<void> => {
  try {
    const filters = ["active=eq.true", "select=id,title,description,amount,currency,pipeline,metadata,created_at", "order=created_at.desc", "limit=100"];
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const pipeline = typeof req.query.pipeline === "string" ? req.query.pipeline : "";
    if (pipeline && pipelines.includes(pipeline as (typeof pipelines)[number])) {
      filters.push(`pipeline=eq.${encodeURIComponent(pipeline)}`);
    }
    if (query) {
      filters.push(`or=(title.ilike.*${encodeURIComponent(query)}*,description.ilike.*${encodeURIComponent(query)}*)`);
    }
    const rows = await supabaseRequest<Record<string, unknown>[]>(`escrow_listings?${filters.join("&")}`);
    res.json(SearchListingsResponse.parse(rows.map(listingOut)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to search listings");
    res.status(errorStatus(error)).json({ error: "Listing search unavailable" });
  }
});

router.post("/listings", async (req, res): Promise<void> => {
  const ownerId = userId(req);
  if (!ownerId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const parsed = CreateListingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (fixedPiUnits(String(parsed.data.amount)) === null) {
    res.status(400).json({ error: "Listing amount must have no more than eight decimal places" });
    return;
  }
  const currency = parsed.data.currency.toUpperCase();
  if (currency !== "PI" && !/^[A-Z]{3}$/.test(currency)) {
    res.status(400).json({ error: "Currency must be PI or a three-letter currency code" });
    return;
  }
  try {
    const identity = await getPiPayoutIdentity(ownerId);
    if (!hasValidPiPayoutIdentity(identity)) {
      res.status(409).json({
        error: "Link your Pi account and save a valid Stellar G-address in your profile before creating or publishing a listing",
      });
      return;
    }
    const [row] = await supabaseRequest<Record<string, unknown>[]>("escrow_listings", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        owner_id: ownerId,
        title: parsed.data.title,
        description: parsed.data.description,
        amount: parsed.data.amount,
        currency,
        pipeline: parsed.data.pipeline,
        metadata: parsed.data.metadata,
        active: false,
      }),
    });
    res.status(201).json(CreateListingResponse.parse(listingOut(row)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to create listing");
    res.status(errorStatus(error)).json({ error: "Could not create listing" });
  }
});

router.post("/listings/:id/contracts", async (req, res): Promise<void> => {
  const actor = userId(req);
  const params = CreateListingContractParams.safeParse({ id: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id });
  const body = CreateListingContractBody.safeParse(req.body);
  if (!actor) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request" : body.error.message });
    return;
  }
  try {
    const listings = await supabaseRequest<Array<Record<string, unknown>>>(
      `escrow_listings?id=eq.${encodeURIComponent(params.data.id)}&active=eq.true&select=*&limit=1`,
    );
    const listing = listings[0];
    if (!listing) { res.status(404).json({ error: "Listing not found" }); return; }
    if (listing.owner_id === actor) { res.status(409).json({ error: "Listing owners cannot buy their own listing" }); return; }
    const [buyerIdentity, sellerIdentity] = await Promise.all([
      getPiPayoutIdentity(actor),
      getPiPayoutIdentity(String(listing.owner_id)),
    ]);
    if (!hasValidPiPayoutIdentity(buyerIdentity)) {
      res.status(409).json({
        error: "Link your Pi account and save a valid Stellar G-address in your profile before starting an escrow",
      });
      return;
    }
    if (!hasValidPiPayoutIdentity(sellerIdentity)) {
      res.status(409).json({
        error: "The seller must link a Pi account and save a valid Stellar G-address before an escrow can start",
      });
      return;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const [created] = await supabaseRequest<ContractRow[]>("escrow_contracts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id,
        title: listing.title,
        reference: id.slice(0, 12).toUpperCase(),
        buyer_id: actor,
        seller_id: listing.owner_id,
        buyer_name: "Buyer",
        seller_name: "Seller",
        amount: listing.amount,
        currency: listing.currency,
        status: "awaiting_funding",
        due_date: body.data.dueDate,
        payment_method: isTestnetWalletHostAllowed(req.hostname) ? "Test-Pi" : "Pi",
        pipeline: listing.pipeline,
        metadata: { ...(listing.metadata as Record<string, unknown> ?? {}), listingId: listing.id },
        next_action: actionForStatus("awaiting_funding"),
        dispute_count: 0,
        release_date: null,
        created_at: now,
        updated_at: now,
      }),
    });
    res.status(201).json(CreateListingContractResponse.parse(mapContract(created)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to start listing escrow");
    res.status(errorStatus(error)).json({ error: "Could not start listing escrow" });
  }
});

router.get("/market/stats", async (req, res): Promise<void> => {
  try {
    const [listings, contracts] = await Promise.all([
      supabaseRequest<Array<{ id: string }>>("escrow_listings?select=id&active=eq.true"),
      supabaseRequest<Array<{ amount: number | string; status: string }>>("escrow_contracts?currency=eq.PI&select=amount,status"),
    ]);
    const units = contracts.reduce((sum, row) => {
      const amount = fixedPiUnits(row.amount);
      if (amount === null) throw new Error("Stored Pi amount has unsupported precision");
      return sum + amount;
    }, 0n);
    const wholePi = units / 100_000_000n;
    const fractionalPi = (units % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
    res.json(GetMarketStatsResponse.parse({
      listings: listings.length,
      contracts: contracts.length,
      completedContracts: contracts.filter((row) => row.status === "completed").length,
      escrowVolume: Number(fractionalPi ? `${wholePi}.${fractionalPi}` : wholePi.toString()),
      escrowVolumeCurrency: "PI",
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to compute market statistics");
    res.status(errorStatus(error)).json({ error: "Market statistics unavailable" });
  }
});

router.post("/contracts/:id/delivery", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = SubmitDeliveryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const contract = await findContract(id);
    const actor = userId(req);
    if (!contract || !actor || !isContractParticipant(contract, actor)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    if (!contract.seller_id || contract.seller_id !== actor) {
      res.status(403).json({ error: "Only the identified seller may submit delivery; this contract has no accepted seller" });
      return;
    }
    if (contract.status !== "funded") {
      res.status(409).json({ error: "Delivery can only be submitted for confirmed funded contracts" });
      return;
    }
    const evidence = parsed.data;
    const pipeline = contract.pipeline ?? "custom_terms";
    if (evidence.filePaths?.length || evidence.receiptObjectPath) {
      res.status(400).json({ error: "Client-supplied object paths are not accepted; use authenticated private evidence uploads" });
      return;
    }
    const verifiedFiles = await listEvidence(id);
    if (pipeline === "digital" && !((evidence.digitalLinks?.length ?? 0) || verifiedFiles.some((file) => file.category === "deliverable" && file.uploader_id === contract.seller_id))) {
      res.status(400).json({ error: "Digital delivery requires at least one link or file" });
      return;
    }
    if (pipeline === "shippable") {
      if (!evidence.carrier?.trim() || !evidence.trackingNumber?.trim()) {
        res.status(400).json({ error: "Shipping delivery requires carrier and tracking number" });
        return;
      }
      if (!verifiedFiles.some((file) => file.category === "receipt" && file.uploader_id === contract.seller_id && file.content_type.startsWith("image/"))) {
        res.status(409).json({ error: "A privately uploaded and verified shipping receipt image is required" });
        return;
      }
    }
    if (pipeline === "local_property" && (
      !evidence.physicalAddress?.trim() ||
      !evidence.mapUrl?.trim() ||
      !evidence.deedReference?.trim() ||
      !evidence.titleReference?.trim()
    )) {
      res.status(400).json({ error: "Local-property evidence requires physical address, map reference, deed and title references, and e-signatures" });
      return;
    }
    if (pipeline === "local_property") {
      if (
        !verifiedFiles.some((file) => file.category === "deed" && file.uploader_id === contract.seller_id) ||
        !verifiedFiles.some((file) => file.category === "title" && file.uploader_id === contract.seller_id)
      ) {
        res.status(409).json({ error: "Private verified deed and title uploads are required" });
        return;
      }
      if (!contract.buyer_id || !contract.seller_id) {
        res.status(409).json({ error: "Both contract participants must be identified before property signing" });
        return;
      }
      const signatures = await supabaseRequest<Array<{ signer_id: string }>>(
        `escrow_signatures?contract_id=eq.${encodeURIComponent(id)}&signer_id=in.(${encodeURIComponent(`${contract.buyer_id},${contract.seller_id}`)})&select=signer_id`,
      );
      const signedBy = new Set(signatures.map((signature) => signature.signer_id));
      if (!signedBy.has(contract.buyer_id) || !signedBy.has(contract.seller_id)) {
        res.status(409).json({ error: "Both authenticated contract participants must sign the property documents" });
        return;
      }
    }
    if (pipeline === "custom_terms" && !evidence.goals?.length) {
      res.status(400).json({ error: "Custom terms delivery requires completed goals" });
      return;
    }
    const [row] = await supabaseRequest<Array<{
      delivery_id: string;
      contract_id: string;
      submitter_id: string;
      evidence: Record<string, unknown>;
      created_at: string;
      submitted_at: string;
    }>>("rpc/submit_escrow_delivery", {
      method: "POST",
      body: JSON.stringify({
        p_contract_id: id,
        p_seller_id: actor,
        p_evidence: evidence,
      }),
    });
    if (!row) {
      res.status(503).json({ error: "Delivery evidence was not persisted; the contract remains unchanged" });
      return;
    }
    res.status(201).json(SubmitDeliveryResponse.parse({
      id: row.delivery_id,
      contractId: row.contract_id,
      submitterId: row.submitter_id,
      evidence: row.evidence,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to record delivery evidence");
    res.status(errorStatus(error)).json({ error: "Could not record delivery evidence" });
  }
});

router.get("/contracts/:id/signatures", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const actor = userId(req);
  try {
    const contract = await findContract(id);
    if (!contract || !actor || !isContractParticipant(contract, actor)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const rows = await supabaseRequest<Record<string, unknown>[]>(
      `escrow_signatures?contract_id=eq.${encodeURIComponent(id)}&select=*&order=signed_at.asc`,
    );
    res.json(ListSignaturesResponse.parse(rows.map((row) => ({
      id: row.id,
      contractId: row.contract_id,
      signerId: row.signer_id,
      documentHash: row.document_hash,
      signedAt: row.signed_at,
    }))));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list signatures");
    res.status(errorStatus(error)).json({ error: "Could not load signatures" });
  }
});

router.post("/contracts/:id/signatures", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const actor = userId(req);
  const parsed = SignContractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const contract = await findContract(id);
    if (!contract || !actor || !isContractParticipant(contract, actor)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const [row] = await supabaseRequest<Record<string, unknown>[]>("escrow_signatures?on_conflict=contract_id,signer_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ contract_id: id, signer_id: actor, document_hash: parsed.data.documentHash }),
    });
    res.status(201).json(SignContractResponse.parse({
      id: row.id, contractId: row.contract_id, signerId: row.signer_id,
      documentHash: row.document_hash, signedAt: row.signed_at,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to record signature");
    res.status(errorStatus(error)).json({ error: "Could not record signature" });
  }
});

router.get("/contracts/:id/messages", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const actor = userId(req);
  const requestedLanguage = req.get("X-Target-Language");
  const supportedLanguages: ChatLanguage[] = ["en", "ar", "zh-CN", "id", "vi"];
  if (requestedLanguage && !supportedLanguages.includes(requestedLanguage as ChatLanguage)) {
    res.status(400).json({ error: "Unsupported target language" });
    return;
  }
  const targetLanguage = (requestedLanguage as ChatLanguage | undefined) ?? "en";
  try {
    const contract = await findContract(id);
    if (!contract || !actor || !isContractParticipant(contract, actor)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const rows = await supabaseRequest<Record<string, unknown>[]>(
      `escrow_messages?contract_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.asc&limit=100`,
    );
    const translations = new Map<string, {
      sourceLanguage: ChatLanguage | null;
      translatedText: string | null;
    }>();
    let canPersistTranslations = true;
    const messageIds = rows
      .map((row) => String(row.id))
      .filter(Boolean);
    if (messageIds.length) {
      const now = Date.now();
      if (now < contractTranslationCacheRetryAfter) {
        canPersistTranslations = false;
      } else {
        try {
          const cached = await supabaseRequest<Array<{
            message_id: string;
            source_language: ChatLanguage;
            translated_text: string | null;
          }>>(
            `escrow_message_translations?message_id=in.(${messageIds.map(encodeURIComponent).join(",")})` +
              `&target_language=eq.${encodeURIComponent(targetLanguage)}` +
              "&select=message_id,source_language,translated_text",
          );
          contractTranslationCacheRetryAfter = 0;
          for (const row of cached) {
            translations.set(row.message_id, {
              sourceLanguage: row.source_language,
              translatedText: row.translated_text,
            });
          }
        } catch (error) {
          canPersistTranslations = false;
          contractTranslationCacheRetryAfter = Date.now() + (isMissingSupabaseRelation(error) ? 60_000 : 10_000);
          if (isMissingSupabaseRelation(error)) {
            req.log.warn(
              { errorType: error instanceof Error ? error.name : "unknown" },
              "Contract translation cache is unavailable; apply the escrow message translations migration",
            );
          } else {
            req.log.warn(
              { errorType: error instanceof Error ? error.name : "unknown" },
              "Could not read cached contract message translations",
            );
          }
        }
      }

      if (canPersistTranslations) {
        const pending = rows.filter((row) => {
          const messageId = String(row.id);
          const sourceText = String(row.source_text ?? row.content ?? "");
          return sourceText.length > 0 &&
            !translations.has(messageId) &&
            (contractTranslationRetryAfter.get(`${messageId}:${targetLanguage}`) ?? 0) <= now;
        }).slice(0, 12);

        for (const row of pending) {
          contractTranslationRetryAfter.set(
            `${String(row.id)}:${targetLanguage}`,
            Date.now() + CONTRACT_TRANSLATION_RETRY_DELAY_MS,
          );
        }

        if (pending.length) {
          try {
            const translated = await translateChatBatch(
              pending.map((row) => ({
                content: String(row.source_text ?? row.content),
              })),
              targetLanguage,
            );
            const cacheRows: Array<{
              message_id: string;
              source_language: ChatLanguage;
              target_language: ChatLanguage;
              translated_text: string | null;
            }> = [];
            pending.forEach((row, index) => {
              const result = translated.get(index);
              if (!result) return;
              const messageId = String(row.id);
              translations.set(messageId, result);
              if (result.sourceLanguage === targetLanguage || result.translatedText) {
                contractTranslationRetryAfter.delete(`${messageId}:${targetLanguage}`);
                cacheRows.push({
                  message_id: messageId,
                  source_language: result.sourceLanguage,
                  target_language: targetLanguage,
                  translated_text: result.translatedText,
                });
              }
            });
            if (cacheRows.length) {
              try {
                await supabaseRequest("escrow_message_translations?on_conflict=message_id,target_language", {
                  method: "POST",
                  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
                  body: JSON.stringify(cacheRows),
                });
              } catch (error) {
                const retryDelay = isMissingSupabaseRelation(error) ? 60_000 : CONTRACT_TRANSLATION_RETRY_DELAY_MS;
                for (const row of cacheRows) {
                  contractTranslationRetryAfter.set(
                    `${row.message_id}:${targetLanguage}`,
                    Date.now() + retryDelay,
                  );
                }
                req.log.warn(
                  { errorType: error instanceof Error ? error.name : "unknown" },
                  "Could not persist contract message translations",
                );
              }
            }
          } catch (error) {
            req.log.warn(
              translationErrorDetails(error),
              "Automatic contract chat translation was unavailable",
            );
          }
        }
      }
    }
    res.json(ListContractMessagesResponse.parse(rows.map((row) => {
      const cachedTranslation = translations.get(String(row.id));
      return {
        id: row.id, contractId: row.contract_id, senderId: row.sender_id,
        content: row.content, sourceText: row.source_text ?? row.content,
        sourceLanguage: cachedTranslation?.sourceLanguage ?? null,
        translatedText: cachedTranslation
          ? cachedTranslation.translatedText
          : row.target_language === targetLanguage && typeof row.translated_text === "string"
            ? row.translated_text
            : null,
        targetLanguage,
        createdAt: row.created_at,
      };
    })));
  } catch (error) {
    req.log.error({ err: error }, "Failed to poll messages");
    res.status(errorStatus(error)).json({ error: "Could not load messages" });
  }
});

router.post("/contracts/:id/messages", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const actor = userId(req);
  const parsed = SendContractMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const contract = await findContract(id);
    if (!contract || !actor || !isContractParticipant(contract, actor)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const [row] = await supabaseRequest<Record<string, unknown>[]>("escrow_messages", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        contract_id: id,
        sender_id: actor,
        content: parsed.data.content,
        source_text: parsed.data.content,
        target_language: parsed.data.targetLanguage ?? "en",
      }),
    });
    const targetLanguage = parsed.data.targetLanguage ?? "en";
    let translatedText: string | null = null;
    let sourceLanguage: ChatLanguage | null = null;
    try {
      const translated = await translateChatBatch([{ content: parsed.data.content }], targetLanguage);
      const result = translated.get(0);
      if (result) {
        sourceLanguage = result.sourceLanguage;
        translatedText = result.translatedText;
        const messageId = String(row.id);
        try {
          await supabaseRequest("escrow_message_translations?on_conflict=message_id,target_language", {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({
              message_id: messageId,
              source_language: sourceLanguage,
              target_language: targetLanguage,
              translated_text: translatedText,
            }),
          });
        } catch (error) {
          if (isMissingSupabaseRelation(error)) {
            contractTranslationCacheRetryAfter = Date.now() + 60_000;
          }
          req.log.warn(
            { errorType: error instanceof Error ? error.name : "unknown" },
            "Could not persist the contract translation cache",
          );
        }
        try {
          await supabaseRequest(`escrow_messages?id=eq.${encodeURIComponent(messageId)}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              source_text: parsed.data.content,
              target_language: targetLanguage,
              translated_text: translatedText,
            }),
          });
        } catch (error) {
          req.log.warn(
            { errorType: error instanceof Error ? error.name : "unknown" },
            "Could not persist the contract message translation",
          );
        }
      }
    } catch (error) {
      req.log.warn(
        translationErrorDetails(error),
        "Gemini translation unavailable; original message retained",
      );
    }
    res.status(201).json(SendContractMessageResponse.parse({
      id: row.id, contractId: id, senderId: actor, content: parsed.data.content,
      sourceText: parsed.data.content, sourceLanguage, translatedText,
      targetLanguage, createdAt: row.created_at,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to send message");
    res.status(errorStatus(error)).json({ error: "Could not send message" });
  }
});

router.get("/profile", async (req, res): Promise<void> => {
  const actor = userId(req);
  if (!actor) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const profile = await getOrCreateProfileRow(actor);
    res.json(GetProfileResponse.parse({
      userId: profile.user_id, displayName: profile.display_name, bio: profile.bio ?? "",
      walletAddress: profile.wallet_address ?? null, referralCode: profile.referral_code,
      referralBalance: Number(profile.referral_balance ?? 0),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to load profile");
    res.status(errorStatus(error)).json({ error: "Could not load profile" });
  }
});

router.put("/profile", async (req, res): Promise<void> => {
  const actor = userId(req);
  if (!actor) { res.status(401).json({ error: "Authentication required" }); return; }
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const walletAddress = parsed.data.walletAddress?.trim() ?? "";
  if (walletAddress && !isValidPiWalletAddress(walletAddress)) {
    res.status(400).json({ error: "Wallet address must be a valid Stellar G-address" });
    return;
  }
  try {
    let referredBy: string | null = null;
    if (parsed.data.inviteCode) {
      const matches = await supabaseRequest<Array<{ user_id: string }>>(
        `escrow_profiles?referral_code=eq.${encodeURIComponent(parsed.data.inviteCode)}&select=user_id&limit=1`,
      );
      if (!matches[0] || matches[0].user_id === actor) {
        res.status(400).json({ error: "Referral code is invalid" });
        return;
      }
      referredBy = matches[0].user_id;
    }
    const prior = await supabaseRequest<Array<{ referral_code: string; referred_by?: string | null }>>(
      `escrow_profiles?user_id=eq.${encodeURIComponent(actor)}&select=referral_code,referred_by&limit=1`,
    );
    const [row] = await supabaseRequest<Record<string, unknown>[]>("escrow_profiles?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        user_id: actor,
        display_name: parsed.data.displayName,
        bio: parsed.data.bio ?? "",
        wallet_address: walletAddress || null,
        referral_code: prior[0]?.referral_code ?? randomUUID().replaceAll("-", "").slice(0, 12),
        referred_by: prior[0]?.referred_by ?? referredBy,
      }),
    });
    res.json(GetProfileResponse.parse({
      userId: row.user_id, displayName: row.display_name, bio: row.bio ?? "",
      walletAddress: row.wallet_address ?? null, referralCode: row.referral_code,
      referralBalance: Number(row.referral_balance ?? 0),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to update profile");
    res.status(errorStatus(error)).json({ error: "Could not update profile" });
  }
});

router.get("/referrals", async (req, res): Promise<void> => {
  const actor = userId(req);
  if (!actor) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const profile = await getOrCreateProfileRow(actor);
    const invited = await supabaseRequest<Array<{ user_id: string }>>(
      `escrow_profiles?referred_by=eq.${encodeURIComponent(actor)}&select=user_id`,
    );
    res.json(GetReferralSummaryResponse.parse({
      referralCode: profile.referral_code,
      referralBalance: Number(profile.referral_balance),
      invitedUsers: invited.length,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to load referral summary");
    res.status(errorStatus(error)).json({ error: "Could not load referral summary" });
  }
});

router.post("/disputes/:id/resolve", async (req, res): Promise<void> => {
  if (!userId(req)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.status(409).json({
    error: "Use the arbitrator dashboard to decide disputes and confirm the associated Pi payout",
  });
});

export default router;