import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";
import { supabaseRequest } from "./supabase";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export type EvidenceCategory = "receipt" | "deed" | "title" | "deliverable";

export type EvidenceRow = {
  id: string;
  contract_id: string;
  uploader_id: string;
  category: EvidenceCategory;
  file_name: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  created_at: string;
};

export type EvidenceMetadata = Omit<EvidenceRow, "object_key">;

export function isAllowedEvidenceType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType.toLowerCase());
}

export function validateEvidenceFilename(filename: unknown): filename is string {
  return (
    typeof filename === "string" &&
    filename.length > 0 &&
    Buffer.byteLength(filename, "utf8") <= 255 &&
    filename !== "." &&
    filename !== ".." &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    !/[\u0000-\u001f\u007f]/u.test(filename)
  );
}

export function isEvidenceCategory(value: unknown): value is EvidenceCategory {
  return (
    value === "receipt" ||
    value === "deed" ||
    value === "title" ||
    value === "deliverable"
  );
}

function privateStorageLocation(): { bucketName: string; prefix: string } {
  const privateDir = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!privateDir) {
    throw new Error("Private object storage is not configured");
  }
  const parts = privateDir.replace(/^\/+/, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Private object storage path is invalid");
  }
  return { bucketName, prefix: parts.join("/") };
}

function safeSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function objectPrefix(contractId: string, ownerId: string): string {
  const { prefix } = privateStorageLocation();
  return [
    prefix,
    "escrow-evidence",
    safeSegment(contractId),
    safeSegment(ownerId),
  ]
    .filter(Boolean)
    .join("/");
}

function objectKeyFor(contractId: string, ownerId: string, key: string): boolean {
  const expectedPrefix = `${objectPrefix(contractId, ownerId)}/`;
  const leaf = key.startsWith(expectedPrefix) ? key.slice(expectedPrefix.length) : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leaf);
}

function bucketFile(objectKey: string): File {
  const { bucketName, prefix } = privateStorageLocation();
  if (
    !objectKey ||
    objectKey.startsWith("/") ||
    objectKey.split("/").some((part) => !part || part === "." || part === "..") ||
    (prefix && !objectKey.startsWith(`${prefix}/`))
  ) {
    throw new Error("Invalid private evidence object key");
  }
  return storage.bucket(bucketName).file(objectKey);
}

export async function createEvidenceUpload(
  contractId: string,
  ownerId: string,
): Promise<{ uploadUrl: string; objectKey: string }> {
  const objectKey = `${objectPrefix(contractId, ownerId)}/${randomUUID()}`;
  const { bucketName } = privateStorageLocation();
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectKey,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Private object upload URL signing failed (${response.status})`);
  }
  const result = (await response.json()) as { signed_url?: unknown };
  if (typeof result.signed_url !== "string" || !result.signed_url.startsWith("https://")) {
    throw new Error("Private object storage returned an invalid upload URL");
  }
  return { uploadUrl: result.signed_url, objectKey };
}

export async function verifyAndTagEvidenceObject(input: {
  contractId: string;
  ownerId: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
}): Promise<File> {
  if (
    !objectKeyFor(input.contractId, input.ownerId, input.objectKey) ||
    !isAllowedEvidenceType(input.contentType) ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_EVIDENCE_BYTES
  ) {
    throw new Error("Evidence object key or metadata is invalid");
  }
  const file = bucketFile(input.objectKey);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error("Uploaded evidence object was not found");
  }
  const [metadata] = await file.getMetadata();
  const storedSize = Number(metadata.size);
  if (
    storedSize !== input.sizeBytes ||
    storedSize <= 0 ||
    storedSize > MAX_EVIDENCE_BYTES ||
    metadata.contentType?.toLowerCase() !== input.contentType.toLowerCase()
  ) {
    throw new Error("Uploaded object size or MIME type does not match the request");
  }
  await file.setMetadata({
    cacheControl: "private, no-store",
    metadata: {
      escrowContractId: input.contractId,
      escrowEvidenceOwnerId: input.ownerId,
    },
  });
  return file;
}

export async function findEvidenceObject(
  row: EvidenceRow,
): Promise<File | null> {
  if (!objectKeyFor(row.contract_id, row.uploader_id, row.object_key)) {
    throw new Error("Stored evidence object key is invalid");
  }
  const file = bucketFile(row.object_key);
  const [exists] = await file.exists();
  if (!exists) {
    return null;
  }
  const [metadata] = await file.getMetadata();
  if (
    metadata.metadata?.escrowContractId !== row.contract_id ||
    metadata.metadata?.escrowEvidenceOwnerId !== row.uploader_id ||
    metadata.contentType?.toLowerCase() !== row.content_type.toLowerCase() ||
    Number(metadata.size) !== Number(row.size_bytes) ||
    Number(metadata.size) <= 0 ||
    Number(metadata.size) > MAX_EVIDENCE_BYTES
  ) {
    throw new Error("Stored evidence object metadata failed verification");
  }
  return file;
}

export function mapEvidence(row: EvidenceRow): EvidenceMetadata {
  const { object_key: _objectKey, ...metadata } = row;
  return metadata;
}

export async function insertEvidence(
  input: Omit<EvidenceRow, "created_at">,
): Promise<EvidenceRow> {
  const rows = await supabaseRequest<EvidenceRow[]>("escrow_evidence", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, created_at: new Date().toISOString() }),
  });
  if (!rows[0]) {
    throw new Error("Evidence metadata was not returned by the database");
  }
  return rows[0];
}

export async function listEvidence(contractId: string): Promise<EvidenceMetadata[]> {
  return supabaseRequest<EvidenceMetadata[]>(
    `escrow_evidence?contract_id=eq.${encodeURIComponent(contractId)}&select=id,contract_id,uploader_id,category,file_name,content_type,size_bytes,created_at&order=created_at.desc`,
  );
}

export async function getEvidence(
  contractId: string,
  evidenceId: string,
): Promise<EvidenceRow | null> {
  const rows = await supabaseRequest<EvidenceRow[]>(
    `escrow_evidence?id=eq.${encodeURIComponent(evidenceId)}&contract_id=eq.${encodeURIComponent(contractId)}&select=id,contract_id,uploader_id,category,file_name,content_type,size_bytes,object_key,created_at&limit=1`,
  );
  return rows[0] ?? null;
}

export const MAX_EVIDENCE_SIZE_BYTES = MAX_EVIDENCE_BYTES;