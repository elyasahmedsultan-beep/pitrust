export const SUPABASE_KEEP_ALIVE_RESOURCE =
  "public_chat_rooms?select=id&limit=1";

type SupabaseRead = <T>(
  resource: string,
  init?: RequestInit,
) => Promise<T>;

export async function querySupabaseKeepAlive(
  read: SupabaseRead,
): Promise<void> {
  await read<Array<{ id: string }>>(SUPABASE_KEEP_ALIVE_RESOURCE);
}