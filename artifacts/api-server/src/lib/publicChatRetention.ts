import { logger } from "./logger";
import {
  buildPublicChatRetentionResource,
  getPublicChatRetentionCutoff,
  isPublicChatRetentionEnabled,
  PUBLIC_CHAT_RETENTION_DAYS,
  PUBLIC_CHAT_RETENTION_INTERVAL_MS,
} from "./publicChatRetentionPolicy";
import { supabaseRequest } from "./supabase";

async function deleteExpiredPublicChatMessages(): Promise<void> {
  const now = new Date();
  await supabaseRequest<void>(buildPublicChatRetentionResource(now), {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  logger.info(
    { cutoff: getPublicChatRetentionCutoff(now) },
    "Public chat retention cleanup completed",
  );
}

export function startPublicChatRetentionCleanup(
  environment = process.env.NODE_ENV,
): () => void {
  if (!isPublicChatRetentionEnabled(environment)) {
    logger.info("Public chat retention cleanup is disabled outside production");
    return () => undefined;
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const runAndReschedule = async (): Promise<void> => {
    try {
      await deleteExpiredPublicChatMessages();
    } catch (error) {
      logger.warn(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Public chat retention cleanup failed; it will retry on the next run",
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void runAndReschedule();
        }, PUBLIC_CHAT_RETENTION_INTERVAL_MS);
        timer.unref?.();
      }
    }
  };

  logger.info(
    {
      retentionDays: PUBLIC_CHAT_RETENTION_DAYS,
      intervalMinutes: PUBLIC_CHAT_RETENTION_INTERVAL_MS / 60_000,
    },
    "Public chat retention cleanup scheduled",
  );
  void runAndReschedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}