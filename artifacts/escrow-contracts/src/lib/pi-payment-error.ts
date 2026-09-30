export function paymentErrorMessage(error: unknown, fallback: string): string {
  const candidate = error && typeof error === "object"
    ? error as { message?: unknown; data?: unknown; response?: { data?: unknown } }
    : {};
  const body = candidate.data ?? candidate.response?.data;
  const serverMessage = typeof body === "string"
    ? body
    : body && typeof body === "object"
      ? ("error" in body && typeof body.error === "string"
          ? body.error
          : "message" in body && typeof body.message === "string"
            ? body.message
            : "detail" in body && typeof body.detail === "string"
              ? body.detail
              : undefined)
      : undefined;
  const message = serverMessage ??
    (typeof candidate.message === "string" ? candidate.message : undefined);
  const clean = message?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300);
  return clean || fallback;
}