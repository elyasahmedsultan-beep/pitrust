import {
  isMissingSupabaseColumn,
  isMissingSupabaseRelation,
  isMissingSupabaseTable,
  supabaseRequest,
} from "./supabase";

const REQUIRED_FEE_KEYS = [
  "transaction_fee_percentage",
  "dispute_resolution_fee_pi",
] as const;

type FeeKey = (typeof REQUIRED_FEE_KEYS)[number];
type SettingRow = Record<string, unknown>;

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