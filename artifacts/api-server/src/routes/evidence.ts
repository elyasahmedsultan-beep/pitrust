import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  createEvidenceUpload,
  findEvidenceObject,
  getEvidence,
  insertEvidence,
  isAllowedEvidenceType,
  isEvidenceCategory,
  listEvidence,
  mapEvidence,
  MAX_EVIDENCE_SIZE_BYTES,
  validateEvidenceFilename,
  verifyAndTagEvidenceObject,
  type EvidenceCategory,
  type EvidenceRow,
} from "../lib/escrowEvidence";
import {
  CreateEvidenceUploadUrlBody,
  CreateEvidenceUploadUrlParams,
  CreateEvidenceUploadUrlResponse,
  ConfirmEvidenceUploadBody,
  ConfirmEvidenceUploadParams,
  ConfirmEvidenceUploadResponse,
  ListContractEvidenceParams,
  ListContractEvidenceResponse,
  DownloadContractEvidenceParams,
} from "@workspace/api-zod";
import { findContract, type ContractRow } from "../lib/escrow";
import { logger } from "../lib/logger";
import { authenticatedUserId, isContractParticipant, requireSession } from "../lib/session";

const router: IRouter = Router();
router.use("/contracts", requireSession);

function pathParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error";
}

async function getAuthorizedContract(
  req: Request,
  res: Response,
): Promise<{ contract: ContractRow; userId: string } | null> {
  const id = pathParam(req.params.id);
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const contract = await findContract(id);
  if (!contract || !isContractParticipant(contract, userId)) {
    res.status(404).json({ error: "Contract not found" });
    return null;
  }
  return { contract, userId };
}

function validUploadMetadata(body: Record<string, unknown>): {
  category: EvidenceCategory;
  fileName: string;
  contentType: string;
  sizeBytes: number;
} | null {
  const { category, filename, contentType, sizeBytes } = body;
  if (
    !isEvidenceCategory(category) ||
    !validateEvidenceFilename(filename) ||
    typeof contentType !== "string" ||
    !isAllowedEvidenceType(contentType) ||
    !Number.isSafeInteger(sizeBytes) ||
    (sizeBytes as number) <= 0 ||
    (sizeBytes as number) > MAX_EVIDENCE_SIZE_BYTES
  ) {
    return null;
  }
  return {
    category,
    fileName: filename as string,
    contentType: contentType.toLowerCase(),
    sizeBytes: sizeBytes as number,
  };
}

router.post("/contracts/:id/evidence/upload-url", async (req, res): Promise<void> => {
  try {
    const params = CreateEvidenceUploadUrlParams.safeParse({ id: pathParam(req.params.id) });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
    const authorized = await getAuthorizedContract(req, res);
    if (!authorized) return;
    const parsed = CreateEvidenceUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const upload = await createEvidenceUpload(
      authorized.contract.id,
      authorized.userId,
    );
    res.json(CreateEvidenceUploadUrlResponse.parse({ ...upload, expiresIn: 900 }));
  } catch (error) {
    logger.error({ err: error }, "Failed to create evidence upload URL");
    res.status(503).json({ error: "Private evidence storage is unavailable; evidence upload was not authorized" });
  }
});

router.post("/contracts/:id/evidence/confirm", async (req, res): Promise<void> => {
  try {
    const params = ConfirmEvidenceUploadParams.safeParse({ id: pathParam(req.params.id) });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
    const authorized = await getAuthorizedContract(req, res);
    if (!authorized) return;
    const parsed = ConfirmEvidenceUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const metadata = validUploadMetadata(parsed.data);
    const objectKey = parsed.data.objectKey;
    if (!metadata) { res.status(400).json({ error: "Evidence metadata is invalid" }); return; }

    try {
      await verifyAndTagEvidenceObject({
        contractId: authorized.contract.id,
        ownerId: authorized.userId,
        objectKey,
        contentType: metadata.contentType,
        sizeBytes: metadata.sizeBytes,
      });
    } catch (error) {
      const message = errorMessage(error);
      if (
        message === "Uploaded evidence object was not found" ||
        message === "Evidence object key or metadata is invalid" ||
        message === "Uploaded object size or MIME type does not match the request"
      ) {
        res.status(400).json({ error: message });
        return;
      }
      throw error;
    }

    const evidence = await insertEvidence({
      id: randomUUID(),
      contract_id: authorized.contract.id,
      uploader_id: authorized.userId,
      category: metadata.category,
      file_name: metadata.fileName,
      content_type: metadata.contentType,
      size_bytes: metadata.sizeBytes,
      object_key: objectKey,
    });
    res.status(201).json(ConfirmEvidenceUploadResponse.parse({ evidence: mapEvidence(evidence) }));
  } catch (error) {
    logger.error({ err: error }, "Failed to confirm contract evidence");
    res.status(503).json({ error: "Private evidence verification is unavailable; evidence was not confirmed" });
  }
});

router.get("/contracts/:id/evidence", async (req, res): Promise<void> => {
  try {
    const params = ListContractEvidenceParams.safeParse({ id: pathParam(req.params.id) });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
    const authorized = await getAuthorizedContract(req, res);
    if (!authorized) return;
    const evidence = await listEvidence(authorized.contract.id);
    res.json(ListContractEvidenceResponse.parse({ evidence }));
  } catch (error) {
    logger.error({ err: error }, "Failed to list contract evidence");
    res.status(500).json({ error: "Unable to list contract evidence" });
  }
});

router.get("/contracts/:id/evidence/:evidenceId", async (req, res): Promise<void> => {
  try {
    const params = DownloadContractEvidenceParams.safeParse({
      id: pathParam(req.params.id),
      evidenceId: pathParam(req.params.evidenceId),
    });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
    const authorized = await getAuthorizedContract(req, res);
    if (!authorized) return;
    const row: EvidenceRow | null = await getEvidence(
      authorized.contract.id,
      pathParam(req.params.evidenceId),
    );
    if (!row) {
      res.status(404).json({ error: "Evidence not found" });
      return;
    }
    const file = await findEvidenceObject(row);
    if (!file) {
      res.status(404).json({ error: "Evidence file not found" });
      return;
    }
    res.setHeader("Content-Type", row.content_type);
    res.setHeader("Content-Length", String(row.size_bytes));
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
    res.setHeader("Cache-Control", "private, no-store");
    const stream = file.createReadStream();
    stream.on("error", (error: Error) => {
      logger.error({ err: error }, "Failed while streaming private evidence");
      if (res.headersSent) {
        res.destroy(error);
      } else {
        res.status(500).json({ error: "Unable to stream evidence file" });
      }
    });
    stream.pipe(res);
  } catch (error) {
    logger.error({ err: error }, "Failed to load contract evidence");
    res.status(500).json({ error: "Unable to load evidence file" });
  }
});

export default router;