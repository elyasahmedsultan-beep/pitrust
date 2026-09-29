const DEFAULT_PI_MAINNET_HOSTS = "pitrustweb.com,*.pitrustweb.com";

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function isPiMainnetHost(
  hostname: string,
  configuredHosts = process.env.PI_MAINNET_HOSTS ?? DEFAULT_PI_MAINNET_HOSTS,
): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;

  return configuredHosts.split(",").some((entry) => {
    const rawRule = entry.trim().toLowerCase().replace(/\.$/, "");
    if (!rawRule) return false;
    if (rawRule.startsWith("*.")) {
      const suffix = normalizeHost(rawRule.slice(2));
      return host !== suffix && host.endsWith(`.${suffix}`);
    }
    return host === normalizeHost(rawRule);
  });
}