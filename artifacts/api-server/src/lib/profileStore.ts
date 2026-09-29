import { randomUUID } from "node:crypto";
import {
  isMissingSupabaseRelation,
  supabaseRequest,
} from "./supabase";

type ProfileCandidate = {
  table: "escrow_profiles" | "profiles" | "users";
  userColumn: "user_id" | "clerk_user_id";
  select: string;
};
type ProfileTable = Pick<ProfileCandidate, "table"> & {
  userColumns: readonly ProfileCandidate["userColumn"][];
};

export type PiProfile = {
  userId: string;
  piUid: string | null;
  table: ProfileCandidate["table"];
  userColumn: ProfileCandidate["userColumn"];
};

export class ProfileStorageUnavailableError extends Error {
  status = 503;

  constructor() {
    super("Account profile storage is unavailable");
    this.name = "ProfileStorageUnavailableError";
  }
}

const profileTables: readonly ProfileTable[] = [
  { table: "escrow_profiles", userColumns: ["user_id"] },
  { table: "profiles", userColumns: ["user_id", "clerk_user_id"] },
  { table: "users", userColumns: ["user_id", "clerk_user_id"] },
];

type ProfileQueryResult = {
  rows: Array<Record<string, unknown>>;
  candidate: ProfileCandidate;
};

async function queryProfileCandidates(
  candidates: ProfileCandidate[],
  buildResource: (candidate: ProfileCandidate) => string,
): Promise<{ result: ProfileQueryResult | null; relationAvailable: boolean }> {
  let relationAvailable = false;
  for (const candidate of candidates) {
    try {
      const rows = await supabaseRequest<unknown>(buildResource(candidate));
      if (!Array.isArray(rows)) throw new ProfileStorageUnavailableError();
      relationAvailable = true;
      const profiles = rows.filter((row): row is Record<string, unknown> =>
          typeof row === "object" && row !== null && !Array.isArray(row),
        );
      if (profiles[0]) return { result: { rows: profiles, candidate }, relationAvailable };
    } catch (error) {
      if (isMissingSupabaseRelation(error)) continue;
      throw error;
    }
  }
  return { result: null, relationAvailable };
}

function normalizeProfile(
  row: Record<string, unknown> | undefined,
  candidate: ProfileCandidate,
): PiProfile | null {
  if (!row) return null;
  const userId = row[candidate.userColumn];
  if (typeof userId !== "string" || !userId) throw new ProfileStorageUnavailableError();
  return {
    userId,
    piUid: typeof row.pi_uid === "string" && row.pi_uid ? row.pi_uid : null,
    table: candidate.table,
    userColumn: candidate.userColumn,
  };
}

export async function findPiProfileByUserId(clerkUserId: string): Promise<PiProfile | null> {
  const encodedUserId = encodeURIComponent(clerkUserId);
  let anyRelationAvailable = false;
  for (const table of profileTables) {
    const candidates = table.userColumns.map((userColumn) => ({
      table: table.table,
      userColumn,
      select: `${userColumn},pi_uid`,
    }));
    const { result, relationAvailable } = await queryProfileCandidates(
      candidates,
      (candidate) =>
        `${candidate.table}?${candidate.userColumn}=eq.${encodedUserId}&select=${candidate.select}&limit=1`,
    );
    anyRelationAvailable ||= relationAvailable;
    if (result) return normalizeProfile(result.rows[0], result.candidate);
    // The first compatible relation is authoritative. Do not silently create
    // a second profile in a different table just because this user has no row.
    if (relationAvailable) return null;
  }
  if (!anyRelationAvailable) throw new ProfileStorageUnavailableError();
  return null;
}

export async function findPiProfileByUid(piUid: string): Promise<PiProfile | null> {
  const encodedPiUid = encodeURIComponent(piUid);
  let anyRelationAvailable = false;
  for (const table of profileTables) {
    const candidates = table.userColumns.map((userColumn) => ({
      table: table.table,
      userColumn,
      select: `${userColumn},pi_uid`,
    }));
    const { result, relationAvailable } = await queryProfileCandidates(
      candidates,
      (candidate) =>
        `${candidate.table}?pi_uid=eq.${encodedPiUid}&select=${candidate.select}&limit=1`,
    );
    anyRelationAvailable ||= relationAvailable;
    if (result) return normalizeProfile(result.rows[0], result.candidate);
    if (relationAvailable) return null;
  }
  if (!anyRelationAvailable) throw new ProfileStorageUnavailableError();
  return null;
}

export async function createCanonicalPiProfile(input: {
  userId: string;
  displayName: string;
  piUid: string;
}): Promise<void> {
  await supabaseRequest("escrow_profiles", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: input.userId,
      display_name: input.displayName,
      referral_code: randomUUID().replaceAll("-", "").slice(0, 12),
      pi_uid: input.piUid,
    }),
  });
}

export async function linkPiUidToProfile(
  profile: PiProfile,
  piUid: string,
): Promise<boolean> {
  const encodedUserId = encodeURIComponent(profile.userId);
  const rows = await supabaseRequest<Array<Record<string, unknown>>>(
    `${profile.table}?${profile.userColumn}=eq.${encodedUserId}&pi_uid=is.null&select=${profile.userColumn},pi_uid`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ pi_uid: piUid }),
    },
  );
  if (rows.length) return true;
  const current = await findPiProfileByUserId(profile.userId);
  return current?.piUid === piUid;
}