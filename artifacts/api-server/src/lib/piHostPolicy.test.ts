import assert from "node:assert/strict";
import test from "node:test";
import { isPiMainnetHost } from "./piHostPolicy.ts";

test("the direct PiTrust site and its subdomains are eligible for Mainnet APIs", () => {
  assert.equal(isPiMainnetHost("pitrustweb.com"), true);
  assert.equal(isPiMainnetHost("WWW.PITRUSTWEB.COM."), true);
  assert.equal(isPiMainnetHost("api.pitrustweb.com"), true);
  assert.equal(isPiMainnetHost("supabase-server-hub.replit.app"), false);
});

test("Mainnet host matching supports exact and wildcard rules", () => {
  assert.equal(isPiMainnetHost("account.example.com", "*.example.com"), true);
  assert.equal(isPiMainnetHost("example.com", "*.example.com"), false);
  assert.equal(isPiMainnetHost("notexample.com", "example.com"), false);
});