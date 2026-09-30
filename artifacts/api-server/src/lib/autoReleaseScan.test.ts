import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstAutoReleaseCandidate,
  scanAutoReleaseCandidates,
  type AutoReleaseCandidate,
} from "./autoReleaseScan.ts";

const candidate: AutoReleaseCandidate = {
  intent_id: "intent-1",
  contract_id: "contract-1",
  amount: "10",
  platform_fee: "0.5",
  inviter_reward: "0",
  seller_amount: "9.5",
  recipient_uid: "seller-pi-uid",
  recipient_wallet_address: "GABC",
  inviter_id: null,
  payment_id: null,
  txid: null,
  network: "Pi Network",
  purpose: "standard_release",
  dispute_id: null,
  seller_id: "seller-1",
};

test("null and empty automatic release results mean there is no candidate", () => {
  assert.equal(firstAutoReleaseCandidate(null), null);
  assert.equal(firstAutoReleaseCandidate(undefined), null);
  assert.equal(firstAutoReleaseCandidate([]), null);
  assert.equal(firstAutoReleaseCandidate([null, undefined]), null);
});

test("automatic release scan stops cleanly when the RPC returns null", async () => {
  let executions = 0;
  await assert.doesNotReject(() => scanAutoReleaseCandidates(
    async () => null,
    async () => {
      executions += 1;
    },
  ));
  assert.equal(executions, 0);
});

test("automatic release scan processes complete candidates and stops on an empty result", async () => {
  const results: unknown[] = [[null, candidate], []];
  const processed: AutoReleaseCandidate[] = [];

  await scanAutoReleaseCandidates(
    async () => results.shift(),
    async (item) => {
      processed.push(item);
    },
  );

  assert.deepEqual(processed, [candidate]);
});

test("automatic release scan rejects malformed results without a TypeError", async () => {
  assert.throws(
    () => firstAutoReleaseCandidate({ data: null }),
    { name: "Error", message: "Automatic escrow release RPC returned a non-array response" },
  );
  assert.throws(
    () => firstAutoReleaseCandidate([{ ...candidate, recipient_uid: null }]),
    { name: "Error", message: "Automatic escrow release RPC returned an incomplete candidate" },
  );
});