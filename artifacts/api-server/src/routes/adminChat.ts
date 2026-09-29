import { Router, type IRouter } from "express";
import {
  AddAdminChatModeratorParams,
  CreateAdminChatRoomBody,
  CreateAdminChatRoomResponse,
  ListAdminChatRoomsResponse,
  RemoveAdminChatModeratorParams,
  SearchAdminChatMembersQueryParams,
  SearchAdminChatMembersResponse,
  UpdateAdminChatRoomBody,
  UpdateAdminChatRoomParams,
  UpdateAdminChatRoomResponse,
} from "@workspace/api-zod";
import type { ChatLanguage } from "@workspace/api-zod";
import {
  requireAdminPasswordSession,
  requireSameOrigin,
} from "../lib/adminPasswordAuth";
import { isMissingSupabaseRelation, supabaseRequest } from "../lib/supabase";

const router: IRouter = Router();

type ChatRoomRow = {
  id: string;
  name: string;
  language_code: ChatLanguage;
  active: boolean;
  created_at: string;
};

type ModeratorRow = {
  room_id: string;
  user_id: string;
  assigned_at: string;
};

router.use("/admin/chat", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.use("/admin/chat", requireAdminPasswordSession);

function pathParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function errorStatus(error: unknown): number {
  if (isMissingSupabaseRelation(error)) return 503;
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: number }).status)
    : 503;
}

function quotedInFilter(values: string[]): string {
  const entries = values.map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`);
  return `in.(${entries.join(",")})`;
}

async function adminRoomResponses(rooms: ChatRoomRow[]) {
  if (!rooms.length) return [];
  const roomIds = rooms.map((room) => room.id);
  const roomFilter = encodeURIComponent(`in.(${roomIds.join(",")})`);
  const moderators = await supabaseRequest<ModeratorRow[]>(
    `public_chat_room_moderators?room_id=${roomFilter}&select=room_id,user_id,assigned_at&order=assigned_at.asc`,
  );
  const userIds = [...new Set(moderators.map((moderator) => moderator.user_id))];
  const profileRows = userIds.length
    ? await supabaseRequest<Array<{ user_id: string; display_name: string }>>(
      `escrow_profiles?user_id=${encodeURIComponent(quotedInFilter(userIds))}&select=user_id,display_name`,
    )
    : [];
  const displayNames = new Map(profileRows.map((profile) => [profile.user_id, profile.display_name]));
  const moderatorsByRoom = new Map<string, Array<{
    userId: string;
    displayName: string;
    assignedAt: string;
  }>>();
  for (const moderator of moderators) {
    const list = moderatorsByRoom.get(moderator.room_id) ?? [];
    list.push({
      userId: moderator.user_id,
      displayName: displayNames.get(moderator.user_id) || "Member",
      assignedAt: moderator.assigned_at,
    });
    moderatorsByRoom.set(moderator.room_id, list);
  }
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    languageCode: room.language_code,
    active: room.active,
    createdAt: room.created_at,
    moderators: moderatorsByRoom.get(room.id) ?? [],
  }));
}

async function findAdminRoom(roomId: string): Promise<ChatRoomRow | null> {
  const rows = await supabaseRequest<ChatRoomRow[]>(
    `public_chat_rooms?id=eq.${encodeURIComponent(roomId)}&select=id,name,language_code,active,created_at&limit=1`,
  );
  return rows[0] ?? null;
}

router.get("/admin/chat/rooms", async (req, res): Promise<void> => {
  try {
    const rooms = await supabaseRequest<ChatRoomRow[]>(
      "public_chat_rooms?select=id,name,language_code,active,created_at&order=language_code.asc,name.asc",
    );
    res.json(ListAdminChatRoomsResponse.parse(await adminRoomResponses(rooms)));
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not list admin chat rooms");
    res.status(errorStatus(error)).json({ error: "Chat room settings are unavailable" });
  }
});

router.post("/admin/chat/rooms", requireSameOrigin, async (req, res): Promise<void> => {
  const parsed = CreateAdminChatRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (name.length < 2) {
    res.status(400).json({ error: "Room name must contain at least two characters" });
    return;
  }
  try {
    const rows = await supabaseRequest<ChatRoomRow[]>("public_chat_rooms", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name,
        language_code: parsed.data.languageCode,
        active: true,
        created_by: "password-admin",
      }),
    });
    const room = rows[0];
    if (!room) throw new Error("Created room was not returned");
    const [response] = await adminRoomResponses([room]);
    res.status(201).json(CreateAdminChatRoomResponse.parse(response));
  } catch (error) {
    const status = errorStatus(error);
    if (status === 409) {
      res.status(409).json({ error: "A room already exists for this language" });
      return;
    }
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not create admin chat room");
    res.status(status).json({ error: "Chat room could not be created" });
  }
});

router.patch("/admin/chat/rooms/:roomId", requireSameOrigin, async (req, res): Promise<void> => {
  const params = UpdateAdminChatRoomParams.safeParse({ roomId: pathParam(req.params.roomId) });
  const parsed = UpdateAdminChatRoomBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) {
    const name = parsed.data.name.trim();
    if (name.length < 2) {
      res.status(400).json({ error: "Room name must contain at least two characters" });
      return;
    }
    update.name = name;
  }
  if (parsed.data.active !== undefined) update.active = parsed.data.active;
  if (!Object.keys(update).length) {
    res.status(400).json({ error: "At least one room field must be changed" });
    return;
  }

  try {
    const rows = await supabaseRequest<ChatRoomRow[]>(
      `public_chat_rooms?id=eq.${encodeURIComponent(params.data.roomId)}&select=id,name,language_code,active,created_at`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...update, updated_at: new Date().toISOString() }),
      },
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Chat room not found" });
      return;
    }
    const [response] = await adminRoomResponses(rows);
    res.json(UpdateAdminChatRoomResponse.parse(response));
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not update admin chat room");
    res.status(errorStatus(error)).json({ error: "Chat room could not be updated" });
  }
});

router.get("/admin/chat/members", async (req, res): Promise<void> => {
  const parsed = SearchAdminChatMembersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search.trim().replaceAll("*", "");
  if (search.length < 2) {
    res.status(400).json({ error: "Search must contain at least two characters" });
    return;
  }
  try {
    const rows = await supabaseRequest<Array<{ user_id: string; display_name: string }>>(
      `escrow_profiles?display_name=ilike.${encodeURIComponent(`*${search}*`)}` +
        "&select=user_id,display_name&order=display_name.asc&limit=25",
    );
    res.json(SearchAdminChatMembersResponse.parse(rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
    }))));
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not search admin chat members");
    res.status(errorStatus(error)).json({ error: "Member search is unavailable" });
  }
});

router.put("/admin/chat/rooms/:roomId/moderators/:userId", requireSameOrigin, async (req, res): Promise<void> => {
  const params = AddAdminChatModeratorParams.safeParse({
    roomId: pathParam(req.params.roomId),
    userId: pathParam(req.params.userId),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const room = await findAdminRoom(params.data.roomId);
    if (!room) {
      res.status(404).json({ error: "Chat room not found" });
      return;
    }
    const members = await supabaseRequest<Array<{ user_id: string }>>(
      `escrow_profiles?user_id=eq.${encodeURIComponent(params.data.userId)}&select=user_id&limit=1`,
    );
    if (!members.length) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    await supabaseRequest(
      "public_chat_room_moderators?on_conflict=room_id,user_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          room_id: params.data.roomId,
          user_id: params.data.userId,
          assigned_by: "password-admin",
        }),
      },
    );
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not assign chat moderator");
    res.status(errorStatus(error)).json({ error: "Moderator could not be assigned" });
  }
});

router.delete("/admin/chat/rooms/:roomId/moderators/:userId", requireSameOrigin, async (req, res): Promise<void> => {
  const params = RemoveAdminChatModeratorParams.safeParse({
    roomId: pathParam(req.params.roomId),
    userId: pathParam(req.params.userId),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const room = await findAdminRoom(params.data.roomId);
    if (!room) {
      res.status(404).json({ error: "Chat room not found" });
      return;
    }
    await supabaseRequest(
      `public_chat_room_moderators?room_id=eq.${encodeURIComponent(params.data.roomId)}` +
        `&user_id=eq.${encodeURIComponent(params.data.userId)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not remove chat moderator");
    res.status(errorStatus(error)).json({ error: "Moderator could not be removed" });
  }
});

export default router;