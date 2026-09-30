// @vitest-environment node

import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { expect, it, vi } from "vitest";

const testDeps = vi.hoisted(() => ({
  authenticatedUserId: vi.fn(),
  findContract: vi.fn(),
  getPaymentFeeSettings: vi.fn(),
  isContractParticipant: vi.fn(),
  linkedPiUid: vi.fn(),
  supabaseRequest: vi.fn(),
}));

vi.mock("../lib/session", () => ({
  requireSession: (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  authenticatedUserId: testDeps.authenticatedUserId,
  isContractParticipant: testDeps.isContractParticipant,
}));

vi.mock("../lib/escrow", () => ({
  findContract: testDeps.findContract,
}));

vi.mock("../lib/appSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/appSettings")>();
  return {
    ...actual,
    getPaymentFeeSettings: testDeps.getPaymentFeeSettings,
  };
});

vi.mock("../lib/supabase", () => ({
  supabaseRequest: testDeps.supabaseRequest,
}));

vi.mock("../lib/pi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pi")>();
  return {
    ...actual,
    linkedPiUid: testDeps.linkedPiUid,
  };
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function postJson(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode ?? 0,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

it("approves and completes a synthetic contract payment through Pi and Supabase mocks", async () => {
  const previousEnv = {
    PI_ENV: process.env.PI_ENV,
    PI_NETWORK_API_KEY: process.env.PI_NETWORK_API_KEY,
    PI_API_KEY: process.env.PI_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  const contract = {
    id: "mock-contract",
    buyer_id: "mock-clerk-user",
    amount: "10",
    currency: "PI",
    status: "awaiting_funding",
  };
  const payment = {
    identifier: "mock-payment",
    amount: "10",
    direction: "user_to_app",
    network: "Pi Network",
    user_uid: "mock-pi-user",
    metadata: { contractId: contract.id },
    status: {
      developer_approved: false,
      transaction_verified: false,
      developer_completed: false,
      cancelled: false,
      user_cancelled: false,
    },
    transaction: { txid: "mock-txid", verified: false },
  };
  const piRequests: Array<{
    path: string;
    method: string;
    authorization: string | null;
    body: unknown;
  }> = [];
  const databaseCalls: Array<{ resource: string; init: RequestInit }> = [];
  let server: ReturnType<typeof createServer> | undefined;

  try {
    process.env.PI_ENV = "mainnet";
    process.env.PI_NETWORK_API_KEY = "synthetic-test-key";
    delete process.env.PI_API_KEY;

    testDeps.authenticatedUserId.mockReturnValue("mock-clerk-user");
    testDeps.findContract.mockResolvedValue(contract);
    testDeps.getPaymentFeeSettings.mockResolvedValue({});
    testDeps.isContractParticipant.mockReturnValue(true);
    testDeps.linkedPiUid.mockResolvedValue("mock-pi-user");
    testDeps.supabaseRequest.mockImplementation(async (resource: string, init: RequestInit = {}) => {
      databaseCalls.push({ resource, init });
      if (resource === "rpc/record_verified_pi_payment") {
        const args = JSON.parse(String(init.body));
        return [{ id: "mock-ledger-row", status: args.p_status }];
      }
      if (resource.startsWith("escrow_contracts?") && init.method === "PATCH") {
        Object.assign(contract, JSON.parse(String(init.body)));
        return [{ id: contract.id }];
      }
      return [];
    });

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      piRequests.push({
        path: url.pathname,
        method,
        authorization: new Headers(init?.headers).get("Authorization"),
        body,
      });

      if (url.pathname.endsWith("/payments/mock-payment/approve") && method === "POST") {
        payment.status.developer_approved = true;
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname.endsWith("/payments/mock-payment/complete") && method === "POST") {
        payment.status.developer_completed = true;
        payment.status.transaction_verified = true;
        payment.transaction.txid = body?.txid;
        payment.transaction.verified = true;
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname.endsWith("/payments/mock-payment") && method === "GET") {
        return new Response(JSON.stringify(payment), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected mock Pi request" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const { default: piRouter } = await import("./pi");
    const app = express();
    app.use(express.json());
    app.use(piRouter);
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as AddressInfo).port;

    const approval = await postJson(port, "/pi/payments/approve", { paymentId: payment.identifier });
    expect(approval.status).toBe(200);
    expect(approval.body).toMatchObject({ approved: true });

    const completion = await postJson(port, "/pi/payments/complete", {
      paymentId: payment.identifier,
      txid: "mock-txid",
    });
    expect(completion.status).toBe(200);
    expect(completion.body).toMatchObject({ funded: true, idempotent: false });

    const repeatedCompletion = await postJson(port, "/pi/payments/complete", {
      paymentId: payment.identifier,
      txid: "mock-txid",
    });
    expect(repeatedCompletion.status).toBe(200);
    expect(repeatedCompletion.body).toMatchObject({ funded: true, idempotent: true });

    expect(piRequests.some((call) =>
      call.path.endsWith("/payments/mock-payment/approve") && call.method === "POST"
    )).toBe(true);
    expect(piRequests.filter((call) =>
      call.path.endsWith("/payments/mock-payment/complete") &&
      call.method === "POST" &&
      (call.body as { txid?: string })?.txid === "mock-txid"
    )).toHaveLength(1);
    expect(piRequests.every((call) => call.authorization === "Key synthetic-test-key")).toBe(true);

    const ledgerWrites = databaseCalls
      .filter((call) => call.resource === "rpc/record_verified_pi_payment")
      .map((call) => JSON.parse(String(call.init.body)));
    expect(ledgerWrites.map((write) => write.p_status)).toEqual(["approved", "confirmed", "confirmed"]);
    expect(ledgerWrites[0]).toMatchObject({
      p_pi_payment_id: payment.identifier,
      p_contract_id: contract.id,
      p_user_id: "mock-clerk-user",
      p_amount: "10",
      p_txid: null,
    });
    expect(ledgerWrites[1]).toMatchObject({
      p_pi_payment_id: payment.identifier,
      p_contract_id: contract.id,
      p_user_id: "mock-clerk-user",
      p_status: "confirmed",
      p_amount: "10",
      p_txid: "mock-txid",
    });

    const contractUpdate = databaseCalls.find((call) =>
      call.resource.startsWith("escrow_contracts?") && call.init.method === "PATCH"
    );
    expect(databaseCalls.filter((call) =>
      call.resource.startsWith("escrow_contracts?") && call.init.method === "PATCH"
    )).toHaveLength(1);
    expect(contractUpdate).toBeDefined();
    expect(JSON.parse(String(contractUpdate?.init.body))).toMatchObject({ status: "funded" });
    expect(payment.status).toMatchObject({
      developer_approved: true,
      transaction_verified: true,
      developer_completed: true,
    });
    expect(payment.transaction).toMatchObject({ txid: "mock-txid", verified: true });
  } finally {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => error ? reject(error) : resolve())
      );
    }
    globalThis.fetch = previousFetch;
    restoreEnv("PI_ENV", previousEnv.PI_ENV);
    restoreEnv("PI_NETWORK_API_KEY", previousEnv.PI_NETWORK_API_KEY);
    restoreEnv("PI_API_KEY", previousEnv.PI_API_KEY);
  }
});