export async function parseSupabaseResponse<T>(
  response: Response,
  allowEmptyBody = false,
): Promise<T> {
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const body = await response.text();
  if (!body.trim()) {
    if (allowEmptyBody) {
      return undefined as T;
    }
    throw new SyntaxError("Supabase returned an empty response body");
  }

  return JSON.parse(body) as T;
}