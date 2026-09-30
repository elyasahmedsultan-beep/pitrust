import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListPublicChatMessagesQueryParams,
  ListPublicChatMessagesResponse,
  ListPublicChatRoomsResponse,
  ModeratePublicChatMessageParams,
  SendPublicChatMessageBody,
  SendPublicChatMessageParams,
  SendPublicChatMessageResponse,
} from "@workspace/api-zod";
import type { ChatLanguage } from "@workspace/api-zod";
import { authenticatedUserId, requireSession } from "../lib/session";
import { requireSameOrigin } from "../lib/adminPasswordAuth";
import { isMissingSupabaseRelation, supabaseRequest } from "../lib/supabase";
import { translateChatBatch, translationErrorDetails } from "../lib/messageTranslation";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ChatRoomRow = {
  id: string;
  name: string;
  language_code: ChatLanguage;
  active: boolean;
};

type ChatMessageRow = {
  id: string;
  room_id: string;
  sender_user_id: string;
  sender_name: string;
  content: string | null;
  source_language: ChatLanguage;
  created_at: string;
  deleted_at: string | null;
};

type Cursor = { createdAt: string; id: string };
const translationRetryAfter = new Map<string, number>();
const TRANSLATION_RETRY_DELAY_MS = 60_000;

router.use("/chat", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
router.use("/rooms", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

function pathParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function errorStatus(error: unknown): number {
  if (isMissingSupabaseRelation(error)) return 503;
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: number }).status)
    : 503;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (
      typeof decoded.createdAt !== "string" ||
      Number.isNaN(Date.parse(decoded.createdAt)) ||
      typeof decoded.id !== "string" ||
      !UUID_PATTERN.test(decoded.id)
    ) {
      throw new Error("Invalid message cursor");
    }
    return { createdAt: new Date(decoded.createdAt).toISOString(), id: decoded.id };
  } catch {
    throw Object.assign(new Error("Invalid message cursor"), { status: 400 });
  }
}

function quotedInFilter(values: string[]): string {
  const entries = values.map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`);
  return `in.(${entries.join(",")})`;
}

async function findRoom(roomId: string): Promise<ChatRoomRow | null> {
  const rows = await supabaseRequest<ChatRoomRow[]>(
    `public_chat_rooms?id=eq.${encodeURIComponent(roomId)}&select=id,name,language_code,active&limit=1`,
  );
  return rows[0] ?? null;
}

async function lookupDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(userIds)];
  if (!uniqueIds.length) return new Map();
  const filter = encodeURIComponent(quotedInFilter(uniqueIds));
  const rows = await supabaseRequest<Array<{ user_id: string; display_name: string }>>(
    `escrow_profiles?user_id=${filter}&select=user_id,display_name`,
  );
  return new Map(rows.map((row) => [row.user_id, row.display_name]));
}

async function readTranslations(
  messageIds: string[],
  targetLanguage: ChatLanguage,
): Promise<Map<string, string>> {
  if (!messageIds.length) return new Map();
  const filter = encodeURIComponent(`in.(${messageIds.join(",")})`);
  const rows = await supabaseRequest<Array<{ message_id: string; translated_text: string }>>(
    `public_chat_message_translations?message_id=${filter}` +
      `&target_language=eq.${encodeURIComponent(targetLanguage)}&select=message_id,translated_text`,
  );
  return new Map(rows.map((row) => [row.message_id, row.translated_text]));
}

async function listPublicChatRooms(req: Request, res: Response): Promise<void> {
  try {
    const rooms = await supabaseRequest<ChatRoomRow[]>(
      "public_chat_rooms?active=eq.true&select=id,name,language_code,active&order=language_code.asc,name.asc",
    );
    res.json(ListPublicChatRoomsResponse.parse(rooms.map((room) => ({
      id: room.id,
      name: room.name,
      languageCode: room.language_code,
      active: room.active,
    }))));
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not list public chat rooms");
    res.status(errorStatus(error)).json({ error: "Chat rooms are unavailable" });
  }
}

router.get("/chat/rooms", listPublicChatRooms);
router.get("/rooms", listPublicChatRooms);

router.use("/chat", requireSession);
router.use("/rooms", requireSession);

router.get("/chat/messages", async (req, res): Promise<void> => {
  const query = ListPublicChatMessagesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { roomId, targetLanguage, cursor: cursorValue, limit } = query.data;
  let cursor: Cursor | null;
  try {
    cursor = decodeCursor(cursorValue);
  } catch {
    res.status(400).json({ error: "Invalid message cursor" });
    return;
  }
  const actor = authenticatedUserId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const room = await findRoom(roomId);
    if (!room || !room.active) {
      res.status(404).json({ error: "Chat room not found" });
      return;
    }

    const cursorFilter = cursor
      ? `&or=${encodeURIComponent(
        `(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`,
      )}`
      : "";
    const rows = await supabaseRequest<ChatMessageRow[]>(
      `public_chat_messages?room_id=eq.${encodeURIComponent(roomId)}` +
        `&select=id,room_id,sender_user_id,sender_name,content,source_language,created_at,deleted_at` +
        `&order=created_at.desc,id.desc&limit=${limit + 1}${cursorFilter}`,
    );
    const hasMore = rows.length > limit;
    const newestFirst = rows.slice(0, limit);
    const oldest = newestFirst.at(-1);
    const nextCursor = hasMore && oldest
      ? encodeCursor({ createdAt: oldest.created_at, id: oldest.id })
      : null;
    const messageIds = newestFirst
      .filter((row) => row.content !== null && row.source_language !== targetLanguage)
      .map((row) => row.id);
    const [moderatorRows, displayNames, translationMap] = await Promise.all([
      supabaseRequest<Array<{ user_id: string }>>(
        `public_chat_room_moderators?room_id=eq.${encodeURIComponent(roomId)}` +
          `&user_id=eq.${encodeURIComponent(actor)}&select=user_id&limit=1`,
      ),
      lookupDisplayNames(newestFirst.map((row) => row.sender_user_id)),
      readTranslations(messageIds, targetLanguage),
    ]);

    const sourceLanguageByMessage = new Map(
      newestFirst.map((row) => [row.id, row.source_language]),
    );
    const untranslated = newestFirst.filter((row) =>
      row.content !== null &&
      row.source_language !== targetLanguage &&
      !translationMap.has(row.id),
    );
    const now = Date.now();
    for (const [key, until] of translationRetryAfter) {
      if (until <= now) translationRetryAfter.delete(key);
    }
    const pendingTranslations = untranslated.filter((row) =>
      (translationRetryAfter.get(`${row.id}:${targetLanguage}`) ?? 0) <= now,
    ).slice(0, 12);
    if (pendingTranslations.length) {
      for (const row of pendingTranslations) {
        translationRetryAfter.set(`${row.id}:${targetLanguage}`, Date.now() + TRANSLATION_RETRY_DELAY_MS);
      }
      try {
        const translated = await translateChatBatch(
          pendingTranslations.map((row) => ({
            content: row.content!,
            sourceLanguageHint: row.source_language,
          })),
          targetLanguage,
        );
        const newTranslations = pendingTranslations.flatMap((row, index) => {
          const result = translated.get(index);
          if (!result) {
            translationRetryAfter.set(`${row.id}:${targetLanguage}`, Date.now() + TRANSLATION_RETRY_DELAY_MS);
            return [];
          }
          sourceLanguageByMessage.set(row.id, result.sourceLanguage);
          if (result.sourceLanguage !== row.source_language) {
            void supabaseRequest(`public_chat_messages?id=eq.${encodeURIComponent(row.id)}`, {
              method: "PATCH",
              headers: { Prefer: "return=minimal" },
              body: JSON.stringify({ source_language: result.sourceLanguage }),
            }).catch((error) => {
              req.log.warn(
                { errorType: error instanceof Error ? error.name : "unknown" },
                "Could not persist detected public chat language",
              );
            });
          }
          if (!result.translatedText) {
            if (result.sourceLanguage === targetLanguage) {
              translationRetryAfter.delete(`${row.id}:${targetLanguage}`);
            } else {
              translationRetryAfter.set(`${row.id}:${targetLanguage}`, Date.now() + TRANSLATION_RETRY_DELAY_MS);
            }
            return [];
          }
          translationRetryAfter.delete(`${row.id}:${targetLanguage}`);
          translationMap.set(row.id, result.translatedText);
          return [{
            message_id: row.id,
            target_language: targetLanguage,
            translated_text: result.translatedText,
          }];
        });
        if (newTranslations.length) {
          try {
            await supabaseRequest("public_chat_message_translations?on_conflict=message_id,target_language", {
              method: "POST",
              headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
              body: JSON.stringify(newTranslations),
            });
          } catch (error) {
            for (const translation of newTranslations) {
              translationRetryAfter.set(
                `${translation.message_id}:${targetLanguage}`,
                Date.now() + TRANSLATION_RETRY_DELAY_MS,
              );
            }
            req.log.warn(
              { errorType: error instanceof Error ? error.name : "unknown" },
              "Could not persist automatic public chat translations",
            );
          }
        }
      } catch (error) {
        for (const row of pendingTranslations) {
          translationRetryAfter.set(`${row.id}:${targetLanguage}`, Date.now() + TRANSLATION_RETRY_DELAY_MS);
        }
        req.log.warn(
          translationErrorDetails(error),
          "Automatic public chat translation was unavailable",
        );
      }
    }

    const messages = [...newestFirst].reverse().map((row) => {
      const isDeleted = row.deleted_at !== null || row.content === null;
      const translatedText = isDeleted ? null : translationMap.get(row.id) ?? null;
      const sourceLanguage = sourceLanguageByMessage.get(row.id) ?? row.source_language;
      const translationStatus = isDeleted
        ? "same_language"
        : sourceLanguage === targetLanguage
          ? "same_language"
          : translatedText
            ? "translated"
            : "unavailable";
      return {
        id: row.id,
        roomId: row.room_id,
        senderName: displayNames.get(row.sender_user_id) || row.sender_name || "Member",
        content: isDeleted ? null : row.content,
        sourceLanguage,
        translatedText,
        translationStatus,
        createdAt: row.created_at,
        isDeleted,
        isOwn: row.sender_user_id === actor,
      };
    });

    res.json(ListPublicChatMessagesResponse.parse({
      messages,
      nextCursor,
      canModerate: moderatorRows.length > 0,
    }));
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not load public chat messages");
    res.status(errorStatus(error)).json({ error: "Chat messages are unavailable" });
  }
});

router.post("/chat/rooms/:roomId/messages", requireSameOrigin, async (req, res): Promise<void> => {
  const params = SendPublicChatMessageParams.safeParse({ roomId: pathParam(req.params.roomId) });
  const body = SendPublicChatMessageBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const content = body.data.content.trim();
  if (!content) {
    res.status(400).json({ error: "Message cannot be blank" });
    return;
  }
  const actor = authenticatedUserId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const room = await findRoom(params.data.roomId);
    if (!room || !room.active) {
      res.status(404).json({ error: "Chat room not found" });
      return;
    }
    const profiles = await supabaseRequest<Array<{ display_name: string }>>(
      `escrow_profiles?user_id=eq.${encodeURIComponent(actor)}&select=display_name&limit=1`,
    );
    const senderName = profiles[0]?.display_name?.trim().slice(0, 100) || "Member";
  const rows = await supabaseRequest<Array<{
      id: string;
      room_id: string;
      content: string;
      source_language: ChatLanguage;
      created_at: string;
    }>>("public_chat_messages", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        room_id: params.data.roomId,
        sender_user_id: actor,
        sender_name: senderName,
        content,
        source_language: room.language_code,
      }),
    });
    const row = rows[0];
    if (!row) throw new Error("Chat message was not returned after insert");
    let sourceLanguage = row.source_language;
    let translatedText: string | null = null;
    let translationStatus: "translated" | "same_language" | "unavailable" = "unavailable";
    try {
      const translations = await translateChatBatch([{
        content: row.content,
        sourceLanguageHint: row.source_language,
      }], body.data.targetLanguage);
      const result = translations.get(0);
      if (result) {
        sourceLanguage = result.sourceLanguage;
        translatedText = result.translatedText;
        translationStatus = translatedText
          ? "translated"
          : sourceLanguage === body.data.targetLanguage
            ? "same_language"
            : "unavailable";
        if (sourceLanguage !== row.source_language) {
          try {
            await supabaseRequest(`public_chat_messages?id=eq.${encodeURIComponent(row.id)}`, {
              method: "PATCH",
              headers: { Prefer: "return=minimal" },
              body: JSON.stringify({ source_language: sourceLanguage }),
            });
          } catch (error) {
            req.log.warn(
              { errorType: error instanceof Error ? error.name : "unknown" },
              "Could not persist detected public chat language",
            );
          }
        }
        if (translatedText) {
          try {
            await supabaseRequest(
              "public_chat_message_translations?on_conflict=message_id,target_language",
              {
                method: "POST",
                headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
                body: JSON.stringify({
                  message_id: row.id,
                  target_language: body.data.targetLanguage,
                  translated_text: translatedText,
                }),
              },
            );
          } catch (error) {
            req.log.warn(
              { errorType: error instanceof Error ? error.name : "unknown" },
              "Could not persist public chat translation",
            );
          }
        }
      }
    } catch (error) {
      req.log.warn(
        translationErrorDetails(error),
        "Automatic public chat translation was unavailable",
      );
    }
    res.status(201).json(SendPublicChatMessageResponse.parse({
      id: row.id,
      roomId: row.room_id,
      senderName,
      content: row.content,
      sourceLanguage,
      translatedText,
      translationStatus,
      createdAt: row.created_at,
      isDeleted: false,
      isOwn: true,
    }));
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not send public chat message");
    res.status(errorStatus(error)).json({ error: "Message could not be sent" });
  }
});

router.delete("/chat/messages/:messageId", requireSameOrigin, async (req, res): Promise<void> => {
  const params = ModeratePublicChatMessageParams.safeParse({
    messageId: pathParam(req.params.messageId),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const actor = authenticatedUserId(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const rows = await supabaseRequest<Array<{
      id: string;
      room_id: string;
      sender_user_id: string;
      deleted_at: string | null;
    }>>(
      `public_chat_messages?id=eq.${encodeURIComponent(params.data.messageId)}` +
        "&select=id,room_id,sender_user_id,deleted_at&limit=1",
    );
    const message = rows[0];
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (message.sender_user_id !== actor) {
      const moderators = await supabaseRequest<Array<{ user_id: string }>>(
        `public_chat_room_moderators?room_id=eq.${encodeURIComponent(message.room_id)}` +
          `&user_id=eq.${encodeURIComponent(actor)}&select=user_id&limit=1`,
      );
      if (!moderators.length) {
        res.status(403).json({ error: "Only the sender or a room moderator can remove this message" });
        return;
      }
    }
    if (message.deleted_at) {
      res.sendStatus(204);
      return;
    }
    await Promise.all([
      supabaseRequest(
        `public_chat_messages?id=eq.${encodeURIComponent(message.id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ content: null, deleted_at: new Date().toISOString(), deleted_by: actor }),
        },
      ),
      supabaseRequest(
        `public_chat_message_translations?message_id=eq.${encodeURIComponent(message.id)}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      ),
    ]);
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not remove public chat message");
    res.status(errorStatus(error)).json({ error: "Message could not be removed" });
  }
});

export default router;