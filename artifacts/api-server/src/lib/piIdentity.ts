import { createHash } from "node:crypto";

export type VerifiedPiIdentity = { uid: string; username: string | null };

export type PiIdentityDependencies = {
  findOwnerByPiUid: (piUid: string) => Promise<string | null>;
  findPiUidByUser: (userId: string) => Promise<string | null | undefined>;
  createClerkUserForPi: (
    piUid: string,
    displayName: string,
  ) => Promise<{ userId: string; created: boolean }>;
  createProfile: (
    userId: string,
    displayName: string,
    piUid: string | null,
  ) => Promise<void>;
  claimPiUid: (userId: string, piUid: string) => Promise<boolean>;
};

export function piReservedEmailAddressForUid(piUid: string): string {
  // RFC 5321 limits the email local part to 64 characters.
  const digest = createHash("sha256").update(piUid).digest("hex").slice(0, 48);
  return `pi-${digest}@example.com`;
}

function identityError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error &&
    Number((error as { status: unknown }).status) === 409;
}

export async function resolvePiIdentityAccount(
  identity: VerifiedPiIdentity,
  createIfMissing: boolean,
  dependencies: PiIdentityDependencies,
): Promise<{ userId: string; createdClerkUserId?: string }> {
  const owner = await dependencies.findOwnerByPiUid(identity.uid);
  if (owner) return { userId: owner };

  if (!createIfMissing) {
    throw identityError("No Pactline account is linked to this Pi identity", 404);
  }

  const clerkUser = await dependencies.createClerkUserForPi(
    identity.uid,
    identity.username ?? "Pi Member",
  );
  const currentPiUid = await dependencies.findPiUidByUser(clerkUser.userId);
  if (currentPiUid && currentPiUid !== identity.uid) {
    throw identityError("The Clerk account already has another Pi identity", 409);
  }

  if (currentPiUid === undefined) {
    try {
      await dependencies.createProfile(
        clerkUser.userId,
        identity.username ?? "Pi Member",
        identity.uid,
      );
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  } else if (currentPiUid === null) {
    try {
      await dependencies.claimPiUid(clerkUser.userId, identity.uid);
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  }

  const canonicalOwner = await dependencies.findOwnerByPiUid(identity.uid);
  if (!canonicalOwner) {
    const afterRacePiUid = await dependencies.findPiUidByUser(clerkUser.userId);
    if (afterRacePiUid && afterRacePiUid !== identity.uid) {
      throw identityError("The Clerk account already has another Pi identity", 409);
    }
    throw identityError("Pi identity could not be assigned", 503);
  }

  return {
    userId: canonicalOwner,
    ...(clerkUser.created && canonicalOwner !== clerkUser.userId
      ? { createdClerkUserId: clerkUser.userId }
      : {}),
  };
}

export async function linkPiIdentity(
  userId: string,
  piUid: string,
  dependencies: Pick<
    PiIdentityDependencies,
    "findOwnerByPiUid" | "findPiUidByUser" | "createProfile" | "claimPiUid"
  >,
): Promise<void> {
  const currentPiUid = await dependencies.findPiUidByUser(userId);
  if (currentPiUid === piUid) return;
  if (currentPiUid != null) {
    throw identityError("A different Pi account is already immutably linked", 409);
  }

  const owner = await dependencies.findOwnerByPiUid(piUid);
  if (owner && owner !== userId) {
    throw identityError("This Pi UID is already linked to another account", 409);
  }

  if (currentPiUid === undefined) {
    try {
      await dependencies.createProfile(userId, "Member", null);
    } catch (error) {
      if (!isConflict(error)) throw error;
      const afterCreateRace = await dependencies.findPiUidByUser(userId);
      if (afterCreateRace === piUid) return;
      if (afterCreateRace !== null) {
        throw identityError("Pi identity could not be linked without reassignment", 409);
      }
    }
  }

  try {
    if (await dependencies.claimPiUid(userId, piUid)) return;
  } catch (error) {
    if (!isConflict(error)) throw error;
  }

  if (await dependencies.findPiUidByUser(userId) !== piUid) {
    throw identityError("Pi identity could not be linked without reassignment", 409);
  }
}