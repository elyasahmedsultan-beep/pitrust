export type PiNetworkEnvironment = "mainnet" | "testnet";

export function configuredPiNetwork(): PiNetworkEnvironment | null {
  const selected = (process.env.PI_NETWORK ?? "testnet").trim().toLowerCase();
  return selected === "mainnet" || selected === "testnet" ? selected : null;
}

export function configuredPiApiKey(): string | undefined {
  const network = configuredPiNetwork();
  const value = network === "testnet"
    ? process.env.PI_TESTNET_API_KEY
    : network === "mainnet"
      ? process.env.PI_API_KEY
      : undefined;
  return value?.trim() || undefined;
}

// Pi app wallets are network-specific. Never fall back from a Testnet wallet
// to the mainnet key (or vice versa).
export function configuredWalletPrivateSeed(): string | undefined {
  const network = configuredPiNetwork();
  if (network === "testnet") {
    return process.env.PI_TESTNET_APP_WALLET_KEY?.trim() || undefined;
  }
  if (network === "mainnet") {
    return process.env.PI_APP_WALLET_KEY?.trim() || undefined;
  }
  return undefined;
}

export function productionPayoutEnabled(): boolean {
  return process.env.NODE_ENV === "production" &&
    process.env.PI_NETWORK?.trim().toLowerCase() === "mainnet" &&
    process.env.PI_A2U_ENABLED === "true" &&
    Boolean(configuredPiApiKey()) &&
    Boolean(configuredWalletPrivateSeed());
}

export function testnetPayoutEnabled(): boolean {
  return process.env.PI_NETWORK?.trim().toLowerCase() === "testnet" &&
    process.env.PI_A2U_TESTNET_ENABLED === "true" &&
    Boolean(configuredPiApiKey()) &&
    Boolean(configuredWalletPrivateSeed());
}

export function payoutExecutionEnabled(): boolean {
  const network = configuredPiNetwork();
  if (network === "mainnet") return productionPayoutEnabled();
  if (network === "testnet") return testnetPayoutEnabled();
  return false;
}