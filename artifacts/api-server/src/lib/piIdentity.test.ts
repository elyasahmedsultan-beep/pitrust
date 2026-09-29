import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  piReservedEmailAddressForUid,
  linkPiIdentity,
  resolvePiIdentityAccount,
  type PiIdentityDependencies,
} from "./piIdentity.ts";

const identity = { uid: "pi-uid-1", username: "pi-user" };

function conflict(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 409 });
}

function createFixture() {
  const piOwners = new Map<string, string>();
  const profiles = new Map<string, string | null>();
  const clerkUsersCreated: string[] = [];

  const dependencies: PiIdentityDependencies = {
    findOwnerByPiUid: async (piUid) => piOwners.get(piUid) ?? null,
    findPiUidByUser: async (userId) =>
      profiles.has(userId) ? profiles.get(userId)! : undefined,
    createClerkUserForPi: async (piUid) => {
      const userId = `clerk:${piUid}`;
      clerkUsersCreated.push(userId);
      return { userId, created: true };
    },
    createProfile: async (userId, _displayName, piUid) => {
      if (profiles.has(userId)) throw conflict("Profile already exists");
      if (piUid && piOwners.has(piUid)) throw conflict("Pi UID already has an owner");
      profiles.set(userId, piUid);
      if (piUid) piOwners.set(piUid, userId);
    },
    claimPiUid: async (userId, piUid) => {
      const owner = piOwners.get(piUid);
      if (owner && owner !== userId) throw conflict("Pi UID already has an owner");
      const current = profiles.get(userId);
      if (current !== null || !profiles.has(userId)) return false;
      profiles.set(userId, piUid);
      piOwners.set(piUid, userId);
      return true;
    },
  };

  return { dependencies, piOwners, profiles, clerkUsersCreated };
}

test("Pi reserved email stays within the email local-part limit", () => {
  const email = piReservedEmailAddressForUid("pi-uid-1");
  const [localPart, domain] = email.split("@");

  assert.equal(domain, "example.com");
  assert.ok(localPart.length <= 64);
  assert.match(localPart, /^pi-[a-f0-9]{48}$/);
  assert.equal(piReservedEmailAddressForUid("pi-uid-1"), email);
});

test("Pi sign-in without a linked UID returns 404 without creating an account", async () => {
  const fixture = createFixture();

  await assert.rejects(
    resolvePiIdentityAccount(identity, false, fixture.dependencies),
    (error: unknown) =>
      typeof error === "object" && error !== null && "status" in error &&
      (error as { status: number }).status === 404,
  );
  assert.deepEqual(fixture.clerkUsersCreated, []);
  assert.equal(fixture.profiles.size, 0);
});

test("explicit Pi sign-up creates the account and binds its UID", async () => {
  const fixture = createFixture();

  const account = await resolvePiIdentityAccount(identity, true, fixture.dependencies);

  assert.equal(account.userId, "clerk:pi-uid-1");
  assert.equal(fixture.piOwners.get(identity.uid), account.userId);
  assert.deepEqual(fixture.clerkUsersCreated, [account.userId]);
});

test("a previously linked Pi UID always resolves to its canonical Clerk user", async () => {
  const fixture = createFixture();
  fixture.piOwners.set(identity.uid, "clerk:canonical");

  const signIn = await resolvePiIdentityAccount(identity, false, fixture.dependencies);
  const signUp = await resolvePiIdentityAccount(identity, true, fixture.dependencies);

  assert.equal(signIn.userId, "clerk:canonical");
  assert.equal(signUp.userId, "clerk:canonical");
  assert.deepEqual(fixture.clerkUsersCreated, []);
});

test("a duplicate Pi UID cannot be linked to another Clerk account", async () => {
  const fixture = createFixture();
  fixture.profiles.set("clerk:owner", identity.uid);
  fixture.piOwners.set(identity.uid, "clerk:owner");

  await assert.rejects(
    linkPiIdentity("clerk:attacker", identity.uid, fixture.dependencies),
    (error: unknown) =>
      typeof error === "object" && error !== null && "status" in error &&
      (error as { status: number }).status === 409,
  );
  assert.equal(fixture.profiles.get("clerk:owner"), identity.uid);
  assert.equal(fixture.profiles.has("clerk:attacker"), false);
});

test("concurrent Pi links on one Clerk account keep only the first UID", async () => {
  const fixture = createFixture();

  const results = await Promise.allSettled([
    linkPiIdentity("clerk:account", "pi-uid-a", fixture.dependencies),
    linkPiIdentity("clerk:account", "pi-uid-b", fixture.dependencies),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const linkedUid = fixture.profiles.get("clerk:account");
  assert.ok(linkedUid === "pi-uid-a" || linkedUid === "pi-uid-b");
  assert.equal(fixture.piOwners.get(linkedUid), "clerk:account");
  assert.equal(fixture.piOwners.has(linkedUid === "pi-uid-a" ? "pi-uid-b" : "pi-uid-a"), false);
});

test("concurrent attempts to claim one Pi UID keep its first Clerk owner", async () => {
  const fixture = createFixture();
  fixture.profiles.set("clerk:account-a", null);
  fixture.profiles.set("clerk:account-b", null);

  const results = await Promise.allSettled([
    linkPiIdentity("clerk:account-a", identity.uid, fixture.dependencies),
    linkPiIdentity("clerk:account-b", identity.uid, fixture.dependencies),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const owner = fixture.piOwners.get(identity.uid);
  assert.ok(owner === "clerk:account-a" || owner === "clerk:account-b");
  assert.equal(fixture.profiles.get(owner), identity.uid);
  assert.equal(fixture.profiles.get(owner === "clerk:account-a" ? "clerk:account-b" : "clerk:account-a"), null);
});

test("a signup race uses the winning UID owner and marks its new Clerk user as disposable", async () => {
  const fixture = createFixture();
  let ownerLookups = 0;
  const dependencies: PiIdentityDependencies = {
    ...fixture.dependencies,
    findOwnerByPiUid: async () => {
      ownerLookups += 1;
      return ownerLookups === 1 ? null : "clerk:linked-account";
    },
    createProfile: async () => {
      throw conflict("Another request claimed this Pi UID first");
    },
  };

  const account = await resolvePiIdentityAccount(identity, true, dependencies);

  assert.equal(account.userId, "clerk:linked-account");
  assert.equal(account.createdClerkUserId, "clerk:pi-uid-1");
});

test("simultaneous explicit sign-ups for one Pi UID converge on one Clerk account", async () => {
  const fixture = createFixture();
  let initialLookups = 0;
  let releaseInitialLookups!: () => void;
  const initialLookupBarrier = new Promise<void>((resolve) => {
    releaseInitialLookups = resolve;
  });
  let clerkUserRequests = 0;
  const dependencies: PiIdentityDependencies = {
    ...fixture.dependencies,
    findOwnerByPiUid: async (piUid) => {
      if (initialLookups < 2) {
        initialLookups += 1;
        if (initialLookups === 2) releaseInitialLookups();
        await initialLookupBarrier;
        return null;
      }
      return fixture.dependencies.findOwnerByPiUid(piUid);
    },
    createClerkUserForPi: async () => {
      clerkUserRequests += 1;
      return { userId: "clerk:canonical-pi-user", created: clerkUserRequests === 1 };
    },
  };

  const accounts = await Promise.all([
    resolvePiIdentityAccount(identity, true, dependencies),
    resolvePiIdentityAccount(identity, true, dependencies),
  ]);

  assert.deepEqual(accounts.map((account) => account.userId), [
    "clerk:canonical-pi-user",
    "clerk:canonical-pi-user",
  ]);
  assert.equal(fixture.piOwners.get(identity.uid), "clerk:canonical-pi-user");
  assert.equal(fixture.profiles.size, 1);
});

test("a Clerk profile with a different Pi UID is never reassigned", async () => {
  const fixture = createFixture();
  fixture.profiles.set("clerk:pi-uid-1", "pi-uid-original");
  fixture.piOwners.set("pi-uid-original", "clerk:pi-uid-1");

  await assert.rejects(
    resolvePiIdentityAccount(identity, true, fixture.dependencies),
    (error: unknown) =>
      typeof error === "object" && error !== null && "status" in error &&
      (error as { status: number }).status === 409,
  );
  assert.equal(fixture.profiles.get("clerk:pi-uid-1"), "pi-uid-original");
  assert.equal(fixture.piOwners.get("pi-uid-original"), "clerk:pi-uid-1");
});