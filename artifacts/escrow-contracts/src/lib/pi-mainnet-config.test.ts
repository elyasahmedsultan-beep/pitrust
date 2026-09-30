import assert from "node:assert/strict";
import test from "node:test";
import { PI_INIT_OPTIONS, PI_SANDBOX } from "./pi-mainnet-config.ts";

test("Pi is fixed to Mainnet and never initializes Sandbox mode", () => {
  assert.equal(PI_SANDBOX, false);
  assert.deepEqual(PI_INIT_OPTIONS, { version: "2.0", sandbox: false });
});