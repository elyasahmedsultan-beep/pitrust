import assert from "node:assert/strict";
import test from "node:test";
import {
  PI_APP_STUDIO_LOGIN_URL,
  verifyPiAccessTokenWithAppStudio,
} from "./piAppStudioAuth.ts";

test("App Studio receives only the Pi access token and its verified UID becomes the identity", async () => {
  let requestUrl = "";
  let requestBody = "";

  const identity = await verifyPiAccessTokenWithAppStudio(
    "pi-access-token",
    async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body);
      return new Response(JSON.stringify({
        sessionToken: "app-studio-session",
        user: { uid: "verified-pi-uid", username: "verified-pioneer" },
      }), { status: 200 });
    },
  );

  assert.equal(requestUrl, PI_APP_STUDIO_LOGIN_URL);
  assert.deepEqual(JSON.parse(requestBody), { accessToken: "pi-access-token" });
  assert.deepEqual(identity, { uid: "verified-pi-uid", username: "verified-pioneer" });
});

test("an invalid Pi access token is rejected without trusting client identity fields", async () => {
  await assert.rejects(
    verifyPiAccessTokenWithAppStudio(
      "invalid",
      async () => new Response("Unauthorized", { status: 401 }),
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 401,
  );
});

test("App Studio's invalid-token client error is treated as an authentication rejection", async () => {
  await assert.rejects(
    verifyPiAccessTokenWithAppStudio(
      "invalid",
      async () => new Response("Bad request", { status: 400 }),
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 401,
  );
});

test("a malformed successful App Studio response fails closed", async () => {
  await assert.rejects(
    verifyPiAccessTokenWithAppStudio(
      "pi-access-token",
      async () => new Response(JSON.stringify({
        sessionToken: "app-studio-session",
        user: { uid: "   ", username: "pioneer" },
      }), { status: 200 }),
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 502,
  );
});

test("App Studio transport failures return a retryable service error", async () => {
  await assert.rejects(
    verifyPiAccessTokenWithAppStudio("pi-access-token", async () => {
      throw new Error("network failure");
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 503,
  );
});