export const PUBLIC_CHAT_RETENTION_DAYS = 3;
export const PUBLIC_CHAT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

const RETENTION_WINDOW_MS = PUBLIC_CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function isPublicChatRetentionEnabled(
  environment = process.env.NODE_ENV,
): boolean {
  return environment === "production";
}

export function getPublicChatRetentionCutoff(now: Date): string {
  return new Date(now.getTime() - RETENTION_WINDOW_MS).toISOString();
}

export function buildPublicChatRetentionResource(now: Date): string {
  return `public_chat_messages?created_at=lt.${encodeURIComponent(
    getPublicChatRetentionCutoff(now),
  )}`;
}