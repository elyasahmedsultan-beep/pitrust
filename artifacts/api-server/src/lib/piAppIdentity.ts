export type VerifiedPiAppIdentity = {
  uid: string;
  username?: string | null;
};

export type PiAppIdentityDependencies = {
  findOwnerByPiUid: (piUid: string) => Promise<string | null>;
  createProfile: (userId: string, username: string, piUid: string) => Promise<void>;
  createAccountId: () => string;
  errorStatus: (error: unknown) => number;
};

export async function resolvePiAppIdentityAccount(
  identity: VerifiedPiAppIdentity,
  createIfMissing: boolean,
  dependencies: PiAppIdentityDependencies,
): Promise<{ userId: string; existingAccount: boolean }> {
  const existingOwner = await dependencies.findOwnerByPiUid(identity.uid);
  if (existingOwner) return { userId: existingOwner, existingAccount: true };
  if (!createIfMissing) {
    throw Object.assign(new Error("No Pactline account is linked to this Pi identity"), {
      status: 404,
    });
  }

  try {
    await dependencies.createProfile(
      dependencies.createAccountId(),
      identity.username ?? "Pi Member",
      identity.uid,
    );
  } catch (error) {
    if (dependencies.errorStatus(error) !== 409) throw error;
    const racedOwner = await dependencies.findOwnerByPiUid(identity.uid);
    if (racedOwner) return { userId: racedOwner, existingAccount: true };
    throw error;
  }

  const canonicalOwner = await dependencies.findOwnerByPiUid(identity.uid);
  if (!canonicalOwner) {
    throw Object.assign(new Error("Pi identity could not be assigned"), { status: 503 });
  }
  return { userId: canonicalOwner, existingAccount: false };
}