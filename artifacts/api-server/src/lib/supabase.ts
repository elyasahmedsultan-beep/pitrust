import { ReplitConnectors } from "@replit/connectors-sdk";
import { parseSupabaseResponse } from "./supabaseResponse.ts";

const connectors = new ReplitConnectors();

export class SupabaseRequestError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, details: unknown) {
    super("Supabase request failed");
    this.name = "SupabaseRequestError";
    this.status = status;
    this.details = details;
  }
}

export async function supabaseRequest<T>(
  resource: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  const headerRecord: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerRecord[key] = value;
  });

  const response = await connectors.proxy(
    "supabase",
    `/rest/v1/${resource}`,
    {
      ...init,
      headers: headerRecord,
    },
  );

  if (!response.ok) {
    const details = await response.json().catch(() => ({
      message: response.statusText,
    }));
    throw new SupabaseRequestError(response.status, details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const expectsMinimalResponse = headers
    .get("Prefer")
    ?.split(",")
    .some((preference) => preference.trim().toLowerCase() === "return=minimal") ?? false;
  return parseSupabaseResponse<T>(response, expectsMinimalResponse);
}

export function isMissingSupabaseTable(error: unknown): boolean {
  if (!(error instanceof SupabaseRequestError)) {
    return false;
  }

  const details = error.details as { code?: string; message?: string } | null;
  return (
    details?.code === "42P01" ||
    details?.code === "PGRST205" ||
    details?.message?.toLowerCase().includes("does not exist") === true
  );
}

export function isMissingSupabaseRelation(error: unknown): boolean {
  if (!(error instanceof SupabaseRequestError)) {
    return false;
  }

  const details = error.details as { code?: string; message?: string } | null;
  const message = details?.message?.toLowerCase() ?? "";
  return (
    isMissingSupabaseTable(error) ||
    isMissingSupabaseColumn(error) ||
    details?.code === "PGRST200" ||
    message.includes("could not find a relationship") ||
    message.includes("schema cache")
  );
}

export function isMissingSupabaseColumn(error: unknown): boolean {
  if (!(error instanceof SupabaseRequestError)) {
    return false;
  }

  const details = error.details as { code?: string; message?: string } | null;
  return (
    details?.code === "42703" ||
    details?.code === "PGRST204" ||
    details?.message?.toLowerCase().includes("column") === true
  );
}