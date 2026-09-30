import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePiAppIdentityAccount,
  type PiAppIdentityDependencies,
} from "./piAppIdentity.ts";

function dependencies(overrides: Partial<PiAppIdentityDependencies> = {}) {
  const calls: Array<{ userId: string; username: string; piUid: string }> = [];
  const deps: PiAppIdentityDependencies = {
    findOwnerByPiUid: async (_piUid: string): Promise<string | null> => null,
    createProfile: async (userId: string, username: string, piUid: string) => {
      calls.push({ userId, username, piUid });
    },
    createAccountId: () => "pi_new-account",
    errorStatus: (error: unknown) => {
      if (typeof error === "object" && error !== null && "status" in error) {
        return Number((error as { status: unknown }).status);
      }
      return 500;
    },
    ...overrides,
  };
  return { deps, calls };
}

test("Pi sign-in resolves the existing canonical owner without provisioning", async () => {
  const { deps, calls } = dependencies({
    findOwnerByPiUid: async () => "clerk_existing_owner",
  });
  const account = await resolvePiAppIdentityAccount(
    { uid: "uid-1", username: "pioneer" },
    false,
    deps,
  );
  assert.deepEqual(account, { userId: "clerk_existing_owner", existingAccount: true });
  assert.deepEqual(calls, []);
});

test("Pi sign-in rejects an unlinked identity without creating an account", async () => {
  const { deps, calls } = dependencies();
  await assert.rejects(
    resolvePiAppIdentityAccount({ uid: "uid-1" }, false, deps),
    (error: unknown) => (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 404
    ),
  );
  assert.deepEqual(calls, []);
});

test("explicit Pi sign-up provisions an app-owned canonical account", async () => {
  let owner: string | null = null;
  const { deps, calls } = dependencies({
    findOwnerByPiUid: async () => owner,
    createProfile: async (userId: string, username: string, piUid: string) => {
      calls.push({ userId, username, piUid });
      owner = userId;
    },
  });
  const account = await resolvePiAppIdentityAccount(
    { uid: "uid-1", username: null },
    true,
    deps,
  );
  assert.deepEqual(account, { userId: "pi_new-account", existingAccount: false });
  assert.deepEqual(calls, [{
    userId: "pi_new-account",
    username: "Pi Member",
    piUid: "uid-1",
  }]);
});

test("concurrent Pi sign-up converges on the winning UID owner", async () => {
  let reads = 0;
  const { deps } = dependencies({
    findOwnerByPiUid: async () => (++reads === 1 ? null : "pi_winning-account"),
    createProfile: async () => {
      throw Object.assign(new Error("unique Pi UID"), { status: 409 });
    },
  });
  const account = await resolvePiAppIdentityAccount(
    { uid: "uid-1", username: "pioneer" },
    true,
    deps,
  );
  assert.deepEqual(account, { userId: "pi_winning-account", existingAccount: true });
});

test("Pi sign-up intent with an existing owner does not create a profile", async () => {
  const { deps, calls } = dependencies({
    findOwnerByPiUid: async () => "pi_existing-account",
  });
  const account = await resolvePiAppIdentityAccount(
    { uid: "uid-1", username: "pioneer" },
    true,
    deps,
  );
  assert.deepEqual(account, { userId: "pi_existing-account", existingAccount: true });
  assert.deepEqual(calls, []);
});