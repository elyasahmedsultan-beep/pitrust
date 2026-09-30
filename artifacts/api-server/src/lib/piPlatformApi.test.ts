import assert from "node:assert/strict";
import test from "node:test";
import { piRequest } from "./piPlatformApi.ts";

test("Pi approve and complete requests send only PI_NETWORK_API_KEY", async () => {
  const previous = {
    PI_ENV: process.env.PI_ENV,
    PI_NETWORK_API_KEY: process.env.PI_NETWORK_API_KEY,
    PI_API_KEY: process.env.PI_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string | undefined; authorization: string | null }> = [];

  try {
    process.env.PI_ENV = "mainnet";
    process.env.PI_NETWORK_API_KEY = "unified-key-for-test";
    process.env.PI_API_KEY = "legacy-key-must-not-be-used";
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await piRequest("/payments/synthetic-payment/approve", { method: "POST" });
    await piRequest("/payments/synthetic-payment/complete", { method: "POST" });

    assert.deepEqual(
      requests.map(({ url, method, authorization }) => ({ url, method, authorization })),
      [
        {
          url: "https://api.minepi.com/v2/payments/synthetic-payment/approve",
          method: "POST",
          authorization: "Key unified-key-for-test",
        },
        {
          url: "https://api.minepi.com/v2/payments/synthetic-payment/complete",
          method: "POST",
          authorization: "Key unified-key-for-test",
        },
      ],
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Pi Platform requests fail closed without PI_NETWORK_API_KEY", async () => {
  const previous = {
    PI_ENV: process.env.PI_ENV,
    PI_NETWORK_API_KEY: process.env.PI_NETWORK_API_KEY,
    PI_API_KEY: process.env.PI_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  let fetchCalled = false;

  try {
    process.env.PI_ENV = "mainnet";
    delete process.env.PI_NETWORK_API_KEY;
    process.env.PI_API_KEY = "legacy-key-must-not-be-used";
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      piRequest("/payments/synthetic-payment/approve", { method: "POST" }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "PI_NETWORK_API_KEY_MISSING",
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});