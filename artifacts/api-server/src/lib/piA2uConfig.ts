export type PiNetworkEnvironment = "mainnet";

export function configuredPiNetwork(): PiNetworkEnvironment | null {
  return process.env.PI_ENV?.trim().toLowerCase() === "mainnet" ? "mainnet" : null;
}

export function configuredPiApiKey(): string | undefined {
  if (configuredPiNetwork() !== "mainnet") return undefined;
  return process.env.PI_API_KEY?.trim() || undefined;
}

export function configuredPiNetworkApiKey(): string | undefined {
  if (configuredPiNetwork() !== "mainnet") return undefined;
  return process.env.PI_NETWORK_API_KEY?.trim() || undefined;
}

export function configuredWalletPrivateSeed(): string | undefined {
  if (configuredPiNetwork() !== "mainnet") return undefined;
  return process.env.PI_APP_WALLET_KEY?.trim() || undefined;
}

export function productionPayoutEnabled(): boolean {
  return process.env.NODE_ENV === "production" &&
    configuredPiNetwork() === "mainnet" &&
    process.env.PI_A2U_ENABLED === "true" &&
    Boolean(configuredPiApiKey()) &&
    Boolean(configuredWalletPrivateSeed());
}

export function payoutExecutionEnabled(): boolean {
  return productionPayoutEnabled();
}