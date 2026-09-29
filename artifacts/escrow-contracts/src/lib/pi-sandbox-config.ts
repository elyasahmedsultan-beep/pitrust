type PiSandboxHostRule = { host: string; wildcard: boolean; sandbox: boolean };

export const DEFAULT_PI_SANDBOX_HOST_RULES =
  "pitrustweb.com=false,*.pitrustweb.com=false,supabase-server-hub.replit.app=true";

function readPiSandboxFallback(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return true;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  throw new Error("VITE_PI_SANDBOX must be either true or false");
}

function parsePiSandboxHostRules(value: string | undefined): PiSandboxHostRule[] {
  if (!value?.trim()) return [];

  return value.split(",").map((entry) => {
    const match = /^\s*(\*\.)?([a-z0-9.-]+)\s*=\s*(true|false)\s*$/i.exec(entry);
    if (!match || match[2].startsWith(".") || match[2].endsWith(".") || match[2].includes("..")) {
      throw new Error(
        "VITE_PI_SANDBOX_HOST_RULES entries must use hostname=true|false, separated by commas",
      );
    }
    return {
      host: match[2].toLowerCase(),
      wildcard: Boolean(match[1]),
      sandbox: match[3].toLowerCase() === "true",
    };
  });
}

function sandboxSettingForHost(hostname: string, rules: PiSandboxHostRule[]): boolean | undefined {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  const matchingRule = rules
    .filter((rule) =>
      rule.wildcard
        ? host !== rule.host && host.endsWith(`.${rule.host}`)
        : host === rule.host,
    )
    .sort((left, right) => {
      if (left.wildcard !== right.wildcard) return left.wildcard ? 1 : -1;
      return right.host.length - left.host.length;
    })[0];
  return matchingRule?.sandbox;
}

export function resolvePiSandboxSetting(
  hostname: string,
  fallback: string | undefined,
  hostRules: string | undefined,
): boolean {
  const hostSetting = sandboxSettingForHost(hostname, parsePiSandboxHostRules(hostRules));
  return hostSetting ?? readPiSandboxFallback(fallback);
}