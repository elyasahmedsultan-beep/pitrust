import { ReplitConnectors } from "@replit/connectors-sdk";
import { parseSupabaseResponse } from "./supabaseResponse.ts";

const connectors = new ReplitConnectors();

export class SupabaseRequestError extends Error {
  status: number;
  details: unknown;
  provider = "supabase";
  code: string;

  constructor(status: number, details: unknown, code?: string) {
    super("Supabase request failed");
    this.name = "SupabaseRequestError";
    this.status = status;
    this.details = details;
    const responseCode = details && typeof details === "object" && "code" in details &&
      typeof details.code === "string"
      ? details.code
      : undefined;
    this.code = code ?? responseCode ?? "SUPABASE_REQUEST_FAILED";
  }
}

const SUPABASE_REQUEST_TIMEOUT_MS = 10_000;

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

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const request = async (): Promise<T> => {
    let response: Response;
    try {
      response = await connectors.proxy(
        "supabase",
        `/rest/v1/${resource}`,
        {
          ...init,
          headers: headerRecord,
        },
      );
    } catch (error) {
      const timedOut = error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw new SupabaseRequestError(
        timedOut ? 504 : 502,
        {
          message: timedOut
            ? `Supabase request timed out after ${SUPABASE_REQUEST_TIMEOUT_MS / 1_000} seconds`
            : "Could not connect to Supabase",
        },
        timedOut ? "SUPABASE_TIMEOUT" : "SUPABASE_UNAVAILABLE",
      );
    }

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
  };

  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new SupabaseRequestError(
        504,
        { message: `Supabase request timed out after ${SUPABASE_REQUEST_TIMEOUT_MS / 1_000} seconds` },
        "SUPABASE_TIMEOUT",
      ));
    }, SUPABASE_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([request(), deadline]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
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