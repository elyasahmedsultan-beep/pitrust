export type PaymentFailure = {
  status: number;
  code: string;
  provider: "pi" | "supabase" | "application";
  message: string;
  retryable: boolean;
};

type ErrorFields = {
  message?: unknown;
  status?: unknown;
  provider?: unknown;
  code?: unknown;
};

function cleanMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return message ? message.slice(0, 300) : undefined;
}

export function describePaymentFailure(error: unknown): PaymentFailure {
  const fields = error && typeof error === "object" ? error as ErrorFields : {};
  const status = typeof fields.status === "number" &&
      Number.isInteger(fields.status) && fields.status >= 400 && fields.status <= 599
    ? fields.status
    : 502;

  if (fields.provider === "pi") {
    const code = typeof fields.code === "string" ? fields.code : "PI_API_ERROR";
    const messages: Record<string, string> = {
      PI_NETWORK_API_KEY_MISSING: "The Pi Network API key for the selected network is not configured.",
      PI_NETWORK_API_KEY_REJECTED: "Pi rejected the server network API key. Check the configured Pi app and network.",
      PI_API_KEY_MISSING: "Pi API credentials for the selected network are not configured.",
      PI_API_KEY_REJECTED: "Pi rejected the server API key for the selected network. Check the Pi Developer Portal app and network.",
      PI_PAYMENT_NOT_FOUND: "Pi could not find this payment using the configured network and app key. Confirm it was created by this Pi app on the same network; older payments may need to be restarted.",
      PI_API_TIMEOUT: "Pi did not respond before the request timed out. The payment state is unknown; check it before retrying.",
      PI_API_UNAVAILABLE: "The server could not connect to Pi. Check the payment status before retrying.",
    };
    return {
      status,
      code,
      provider: "pi",
      message: messages[code] ?? `Pi payment service rejected the request (HTTP ${status}).`,
      retryable: code === "PI_API_TIMEOUT" || code === "PI_API_UNAVAILABLE" || status >= 500,
    };
  }

  if (fields.provider === "supabase") {
    const details = "details" in (error as object)
      ? (error as { details?: unknown }).details
      : undefined;
    const detailCode = details && typeof details === "object" && "code" in details &&
        typeof details.code === "string"
      ? details.code
      : undefined;
    const code = detailCode ?? (typeof fields.code === "string"
      ? fields.code
      : "SUPABASE_REQUEST_FAILED");
    const databaseStatus = code === "42702" || code === "42P01" || code === "42703"
      ? 502
      : status;
    const message = code === "42702"
      ? "The payment database rejected a query because a column name is ambiguous (42702)."
      : code === "42P01" || code === "PGRST205"
        ? "The payment database is missing a required table (42P01)."
        : code === "42703" || code === "PGRST204"
          ? "The payment database is missing a required column (42703)."
          : code === "SUPABASE_TIMEOUT"
            ? "The payment database did not respond before the request timed out. Check payment status before retrying."
            : code === "SUPABASE_UNAVAILABLE"
              ? "The server could not connect to the payment database."
              : `The payment database rejected the request (database error ${code}).`;
    return {
      status: databaseStatus,
      code,
      provider: "supabase",
      message,
      retryable: code === "SUPABASE_TIMEOUT" || code === "SUPABASE_UNAVAILABLE" ||
        databaseStatus >= 500 || databaseStatus === 429,
    };
  }

  return {
    status,
    code: typeof fields.code === "string" ? fields.code : "PAYMENT_PROCESSING_FAILED",
    provider: "application",
    message: cleanMessage(fields.message) ?? "Pi payment processing failed.",
    retryable: status >= 500 || status === 429,
  };
}