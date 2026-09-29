export const ESCROW_SERVICE_DEPOSIT = {
  productName: "Escrow Service Deposit",
  description: "Secure funds held in escrow for freelance service",
  amount: 1,
  memo: "Escrow deposit for job agreement",
  metadata: { type: "escrow" },
} as const;

export type EscrowServiceDepositPayment = {
  identifier?: string;
  amount?: number | string;
  memo?: string;
  direction?: string;
  network?: string;
  user_uid?: string;
  metadata?: Record<string, unknown>;
  status?: {
    transaction_verified?: boolean;
    developer_completed?: boolean;
    cancelled?: boolean;
    user_cancelled?: boolean;
  };
};

function fixedPiUnits(value: number | string): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
  if (!match) return null;
  const exponent = Number(match[3] ?? "0");
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null;
  let digits = `${match[1]}${match[2] ?? ""}`.replace(/^0+(?=\d)/, "");
  let decimalPlaces = (match[2] ?? "").length - exponent;
  if (decimalPlaces > 8) {
    const excess = decimalPlaces - 8;
    if (!digits.endsWith("0".repeat(excess))) return null;
    digits = digits.slice(0, -excess);
    decimalPlaces = 8;
  }
  if (decimalPlaces < 0) {
    digits += "0".repeat(-decimalPlaces);
    decimalPlaces = 0;
  }
  return BigInt(digits || "0") * 10n ** BigInt(8 - decimalPlaces);
}

export function verifyEscrowServiceDepositPayment(
  paymentId: string,
  payment: EscrowServiceDepositPayment,
  expectedPiUid: string,
  expectedNetwork: string | null,
): void {
  const metadata = payment.metadata;
  const metadataKeys = metadata ? Object.keys(metadata) : [];
  if (
    expectedNetwork !== "Pi Network" ||
    payment.identifier !== paymentId ||
    fixedPiUnits(payment.amount ?? "") !== fixedPiUnits(ESCROW_SERVICE_DEPOSIT.amount) ||
    payment.memo !== ESCROW_SERVICE_DEPOSIT.memo ||
    payment.direction !== "user_to_app" ||
    payment.network !== "Pi Network" ||
    payment.user_uid !== expectedPiUid ||
    metadata?.type !== ESCROW_SERVICE_DEPOSIT.metadata.type ||
    metadataKeys.length !== 1 ||
    payment.status?.cancelled ||
    payment.status?.user_cancelled ||
    (payment.status?.developer_completed && !payment.status?.transaction_verified)
  ) {
    throw Object.assign(new Error("Pi payment does not match the escrow service deposit"), { status: 400 });
  }
}