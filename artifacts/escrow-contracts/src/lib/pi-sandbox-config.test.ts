import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PI_SANDBOX_HOST_RULES,
  resolvePiSandboxSetting,
} from "./pi-sandbox-config.ts";

test("the direct PiTrust domain uses Mainnet mode while the registered Sandbox URL stays on Testnet", () => {
  assert.equal(resolvePiSandboxSetting("pitrustweb.com", "true", DEFAULT_PI_SANDBOX_HOST_RULES), false);
  assert.equal(resolvePiSandboxSetting("www.pitrustweb.com", "true", DEFAULT_PI_SANDBOX_HOST_RULES), false);
  assert.equal(resolvePiSandboxSetting("api.pitrustweb.com", "true", DEFAULT_PI_SANDBOX_HOST_RULES), false);
  assert.equal(resolvePiSandboxSetting(
    "supabase-server-hub.replit.app",
    "false",
    DEFAULT_PI_SANDBOX_HOST_RULES,
  ), true);
});

test("the environment fallback applies to hosts without an explicit rule", () => {
  assert.equal(resolvePiSandboxSetting("preview.replit.dev", "true", DEFAULT_PI_SANDBOX_HOST_RULES), true);
  assert.equal(resolvePiSandboxSetting("preview.replit.dev", "false", DEFAULT_PI_SANDBOX_HOST_RULES), false);
});

test("explicit host rules support wildcards and exact rules take precedence", () => {
  const rules = "*.example.com=true,live.example.com=false";
  assert.equal(resolvePiSandboxSetting("preview.example.com", "false", rules), true);
  assert.equal(resolvePiSandboxSetting("live.example.com", "true", rules), false);
  assert.equal(resolvePiSandboxSetting("example.com", "false", rules), false);
});

test("invalid sandbox settings fail rather than silently choosing a network", () => {
  assert.throws(() => resolvePiSandboxSetting("unknown.example", "enabled", ""), /VITE_PI_SANDBOX/);
  assert.throws(() => resolvePiSandboxSetting("unknown.example", "true", "example.com=yes"), /VITE_PI_SANDBOX_HOST_RULES/);
});