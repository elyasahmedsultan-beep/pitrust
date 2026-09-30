import {
  isMissingSupabaseColumn,
  isMissingSupabaseRelation,
  isMissingSupabaseTable,
  supabaseRequest,
} from "./supabase.ts";
import { isFlexiblePiAmount } from "./piAmount.ts";

const REQUIRED_FEE_KEYS = [
  "transaction_fee_percentage",
  "dispute_resolution_fee_pi",
] as const;

type FeeKey = (typeof REQUIRED_FEE_KEYS)[number];
type SettingRow = Record<string, unknown>;

const LISTING_AD_FEE_SETTINGS = [
  { key: "listing_ad_fee_pi", field: "listingAdFeePi", defaultValue: 1 },
  { key: "listing_ad_edit_fee_pi", field: "listingEditFeePi", defaultValue: 0.25 },
  { key: "listing_ad_delete_fee_pi", field: "listingDeleteFeePi", defaultValue: 0.25 },
] as const;
export const DEFAULT_LISTING_AD_FEE_PI = 1;
export const DEFAULT_LISTING_EDIT_FEE_PI = 0.25;
export const DEFAULT_LISTING_DELETE_FEE_PI = 0.25;
const LISTING_AD_FEE_LAYOUTS = [
  { keyColumn: "key", valueColumn: "value" },
  { keyColumn: "setting_key", valueColumn: "setting_value" },
  { keyColumn: "setting_name", valueColumn: "setting_value" },
  { keyColumn: "name", valueColumn: "value" },
] as const;

export type ListingAdFees = {
  listingAdFeePi: number;
  listingEditFeePi: number;
  listingDeleteFeePi: number;
};

export type PaymentFeeSettings = {
  /** Percentage points: 3 means a 3% seller-side platform fee. */
  transactionFeePercentage: number;
  disputeResolutionFeePi: number;
};

export class FeeSettingsUnavailableError extends Error {
  status = 503;

  constructor(message = "Payment fee settings are unavailable") {
    super(message);
    this.name = "FeeSettingsUnavailableError";
  }
}

function settingNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPiAmount(value: number): boolean {
  return value > 0 && value <= 1_000_000_000 &&
    /^\d+(?:\.\d{1,8})?$/.test(String(value));
}

function collectKeyValueRows(
  rows: SettingRow[],
  keyColumns: readonly string[],
  valueColumns: readonly string[],
): Map<FeeKey, number> {
  const found = new Map<FeeKey, number>();
  for (const row of rows) {
    const keyValue = keyColumns.map((column) => row[column]).find((value) => typeof value === "string");
    if (typeof keyValue !== "string" || !REQUIRED_FEE_KEYS.includes(keyValue as FeeKey)) continue;
    const rawValue = valueColumns.map((column) => row[column]).find((value) => value !== undefined);
    const parsed = settingNumber(rawValue);
    if (parsed !== null) found.set(keyValue as FeeKey, parsed);
  }
  return found;
}

async function querySettings(resource: string): Promise<SettingRow[]> {
  const rows = await supabaseRequest<unknown>(resource);
  if (!Array.isArray(rows)) throw new FeeSettingsUnavailableError();
  return rows.filter((row): row is SettingRow =>
    typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

/**
 * Read the current values on every call. Supports the canonical key/value
 * relation, common setting_key/setting_value naming, and a single wide row.
 * Missing or invalid configuration fails closed; no payment path guesses a fee.
 */
export async function getPaymentFeeSettings(): Promise<PaymentFeeSettings> {
  const names = REQUIRED_FEE_KEYS.join(",");
  const layouts = [
    {
      resource: `app_settings?select=key,value&key=in.(${names})`,
      keys: ["key"],
      values: ["value"],
    },
    {
      resource: `app_settings?select=setting_key,setting_value&setting_key=in.(${names})`,
      keys: ["setting_key"],
      values: ["setting_value"],
    },
    {
      resource: `app_settings?select=setting_name,setting_value&setting_name=in.(${names})`,
      keys: ["setting_name"],
      values: ["setting_value"],
    },
    {
      resource: `app_settings?select=name,value&name=in.(${names})`,
      keys: ["name"],
      values: ["value"],
    },
  ] as const;

  const values = new Map<FeeKey, number>();
  let missingRelation = false;
  for (const layout of layouts) {
    try {
      for (const [key, value] of collectKeyValueRows(
        await querySettings(layout.resource),
        layout.keys,
        layout.values,
      )) {
        values.set(key, value);
      }
    } catch (error) {
      if (isMissingSupabaseTable(error)) {
        missingRelation = true;
        break;
      }
      if (isMissingSupabaseColumn(error) || isMissingSupabaseRelation(error)) continue;
      throw new FeeSettingsUnavailableError();
    }
    if (values.size === REQUIRED_FEE_KEYS.length) break;
  }

  if (!missingRelation && values.size < REQUIRED_FEE_KEYS.length) {
    try {
      const rows = await querySettings(
        "app_settings?select=transaction_fee_percentage,dispute_resolution_fee_pi&limit=1",
      );
      const wideRow = rows[0];
      if (wideRow) {
        for (const key of REQUIRED_FEE_KEYS) {
          const parsed = settingNumber(wideRow[key]);
          if (parsed !== null) values.set(key, parsed);
        }
      }
    } catch (error) {
      if (!isMissingSupabaseColumn(error) && !isMissingSupabaseRelation(error) &&
          !isMissingSupabaseTable(error)) {
        throw new FeeSettingsUnavailableError();
      }
    }
  }

  const transactionFeePercentage = values.get("transaction_fee_percentage");
  const disputeResolutionFeePi = values.get("dispute_resolution_fee_pi");
  if (
    missingRelation ||
    transactionFeePercentage === undefined ||
    transactionFeePercentage < 0 ||
    transactionFeePercentage >= 100 ||
    disputeResolutionFeePi === undefined ||
    !isPiAmount(disputeResolutionFeePi)
  ) {
    throw new FeeSettingsUnavailableError();
  }

  return { transactionFeePercentage, disputeResolutionFeePi };
}

function validListingAdFee(value: unknown): number | null {
  const parsed = settingNumber(value);
  return parsed !== null && isFlexiblePiAmount(parsed) ? parsed : null;
}

async function readListingAdFee(key: string, fallback: number): Promise<number> {
  for (const layout of LISTING_AD_FEE_LAYOUTS) {
    try {
      const rows = await querySettings(
        `app_settings?select=${layout.keyColumn},${layout.valueColumn}&${layout.keyColumn}=eq.${encodeURIComponent(key)}&limit=1`,
      );
      const setting = rows[0];
      if (!setting) continue;
      const rawValue = setting[layout.valueColumn];
      const fee = validListingAdFee(rawValue);
      if (fee === null) {
        throw new FeeSettingsUnavailableError("Listing ad fee setting is invalid");
      }
      return fee;
    } catch (error) {
      if (isMissingSupabaseTable(error)) return fallback;
      if (isMissingSupabaseColumn(error)) continue;
      if (isMissingSupabaseRelation(error)) continue;
      if (error instanceof FeeSettingsUnavailableError) throw error;
      throw new FeeSettingsUnavailableError();
    }
  }

  try {
    const rows = await querySettings("app_settings?select=*&limit=1");
    const setting = rows[0];
    if (!setting || !(key in setting)) {
      return fallback;
    }
    const rawValue = setting[key];
    const fee = validListingAdFee(rawValue);
    if (fee === null) {
      throw new FeeSettingsUnavailableError("Listing ad fee setting is invalid");
    }
    return fee;
  } catch (error) {
    if (
      isMissingSupabaseColumn(error) ||
      isMissingSupabaseTable(error) ||
      isMissingSupabaseRelation(error)
    ) {
      return fallback;
    }
    if (error instanceof FeeSettingsUnavailableError) throw error;
    throw new FeeSettingsUnavailableError();
  }
}

/** Read all three listing charges fresh so new payment intents use current settings. */
export async function getListingAdFees(): Promise<ListingAdFees> {
  const values = await Promise.all(
    LISTING_AD_FEE_SETTINGS.map((setting) => readListingAdFee(setting.key, setting.defaultValue)),
  );
  return {
    listingAdFeePi: values[0],
    listingEditFeePi: values[1],
    listingDeleteFeePi: values[2],
  };
}

export async function getListingAdFeePi(): Promise<number> {
  return (await getListingAdFees()).listingAdFeePi;
}

async function writeListingAdFee(key: string, value: number): Promise<void> {
  if (!isFlexiblePiAmount(value)) {
    throw Object.assign(
      new Error("Listing ad fees must be positive Pi amounts with up to 8 decimal places"),
      { status: 400 },
    );
  }

  for (const layout of LISTING_AD_FEE_LAYOUTS) {
    try {
      const settingPath =
        `app_settings?${layout.keyColumn}=eq.${encodeURIComponent(key)}`;
      const existing = await querySettings(
        `${settingPath}&select=${layout.keyColumn}&limit=1`,
      );
      if (existing.length) {
        await supabaseRequest<unknown>(settingPath, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ [layout.valueColumn]: value }),
        });
      } else {
        await supabaseRequest<unknown>("app_settings", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            [layout.keyColumn]: key,
            [layout.valueColumn]: value,
          }),
        });
      }
      return;
    } catch (error) {
      if (isMissingSupabaseTable(error)) throw new FeeSettingsUnavailableError();
      if (isMissingSupabaseColumn(error)) continue;
      if (isMissingSupabaseRelation(error)) continue;
      throw new FeeSettingsUnavailableError();
    }
  }

  try {
    const rows = await querySettings("app_settings?select=*&limit=2");
    if (
      rows.length !== 1 ||
      rows[0].id === undefined ||
      rows[0].id === null ||
      !(key in rows[0])
    ) {
      throw new FeeSettingsUnavailableError("Listing ad fee settings use an unsupported table layout");
    }
    await supabaseRequest<unknown>(
      `app_settings?id=eq.${encodeURIComponent(String(rows[0].id))}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ [key]: value }),
      },
    );
  } catch (error) {
    if (error instanceof FeeSettingsUnavailableError) throw error;
    throw new FeeSettingsUnavailableError();
  }
}

export async function updateListingAdFeeSettings(
  patch: Partial<ListingAdFees>,
): Promise<ListingAdFees> {
  const requested = LISTING_AD_FEE_SETTINGS.filter((setting) =>
    Object.hasOwn(patch, setting.field),
  );
  if (!requested.length) {
    throw Object.assign(new Error("At least one listing ad fee is required"), { status: 400 });
  }
  for (const setting of requested) {
    const value = patch[setting.field];
    if (typeof value !== "number" || !isFlexiblePiAmount(value)) {
      throw Object.assign(
        new Error("Listing ad fees must be positive Pi amounts with up to 8 decimal places"),
        { status: 400 },
      );
    }
    await writeListingAdFee(setting.key, value);
  }
  return getListingAdFees();
}

export async function updateListingAdFeePi(value: number): Promise<number> {
  const updated = await updateListingAdFeeSettings({ listingAdFeePi: value });
  return updated.listingAdFeePi;
}