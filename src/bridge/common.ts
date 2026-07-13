import type { FubonAccount } from "../connectors/fubon-connector.ts";
import type { Connector } from "../connectors/connector.ts";

export interface BridgeConnector extends Connector {
  readonly accounts: readonly FubonAccount[];
  readonly simulation?: boolean;
}

export interface FubonResult<T = unknown> {
  isSuccess: boolean;
  data?: T;
  message?: string;
}

export class BridgeHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

export interface AccountRequest {
  account_type?: "S" | "F";
  broker_id?: string;
  account_id?: string;
  person_id?: string | null;
  [key: string]: unknown;
}

export function bridgeError(
  status: number,
  message: string,
  details: unknown = null,
  headers?: Record<string, string>,
): Response {
  return Response.json({ code: status, message, details }, { status, headers });
}

export function unsupported(path: string, reason?: string): never {
  throw new BridgeHttpError(
    501,
    reason ?? `Shioaji bridge endpoint is not implemented: ${path}`,
  );
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new BridgeHttpError(400, "Request body must contain valid JSON");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BridgeHttpError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function assertAllowedFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).find((field) => !allowedSet.has(field));
  if (unknown) {
    throw new BridgeHttpError(400, `Unknown field: ${unknown}`);
  }
}

export function stringField(
  body: Record<string, unknown>,
  field: string,
  required = false,
): string | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new BridgeHttpError(400, `${field} must be a non-empty string`);
  }
  return value;
}

export function numberField(
  body: Record<string, unknown>,
  field: string,
  required = false,
): number | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BridgeHttpError(400, `${field} must be a number`);
  }
  return value;
}

export function booleanField(
  body: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new BridgeHttpError(400, `${field} must be a boolean`);
  }
  return value;
}

export function objectField(
  body: Record<string, unknown>,
  field: string,
  required = false,
): Record<string, unknown> | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BridgeHttpError(400, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function arrayField(
  body: Record<string, unknown>,
  field: string,
): unknown[] {
  const value = body[field];
  if (!Array.isArray(value)) {
    throw new BridgeHttpError(400, `${field} must be an array`);
  }
  return value;
}

export function selectAccount(
  accounts: readonly FubonAccount[],
  request: AccountRequest,
  defaultType: "S" | "F",
): FubonAccount {
  const accountType = request.account_type ?? defaultType;
  if (accountType !== "S" && accountType !== "F") {
    throw new BridgeHttpError(400, 'account_type must be "S" or "F"');
  }
  if (
    request.person_id !== undefined &&
    request.person_id !== null &&
    typeof request.person_id !== "string"
  ) {
    throw new BridgeHttpError(400, "person_id must be a string or null");
  }
  if (typeof request.person_id === "string") {
    throw new BridgeHttpError(
      501,
      "person_id account selection is unavailable from Fubon login data",
    );
  }
  if (
    request.broker_id !== undefined &&
    typeof request.broker_id !== "string"
  ) {
    throw new BridgeHttpError(400, "broker_id must be a string");
  }
  if (
    request.account_id !== undefined &&
    typeof request.account_id !== "string"
  ) {
    throw new BridgeHttpError(400, "account_id must be a string");
  }

  const fubonType = accountType === "S" ? "stock" : "futopt";
  const account = accounts.find(
    (candidate) =>
      candidate.accountType === fubonType &&
      (request.broker_id === undefined ||
        candidate.branchNo === request.broker_id) &&
      (request.account_id === undefined ||
        candidate.account === request.account_id),
  );
  if (!account) {
    throw new BridgeHttpError(400, "Requested account is unavailable");
  }
  return account;
}

export function unwrapFubon<T>(value: unknown, operation: string): T {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Partial<FubonResult>).isSuccess !== "boolean"
  ) {
    throw new Error(`Fubon ${operation} returned an invalid response`);
  }
  const result = value as FubonResult<T>;
  if (!result.isSuccess) {
    throw new Error(result.message ?? `Fubon ${operation} failed`);
  }
  return result.data as T;
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Upstream response item must be an object");
  }
  return value as Record<string, unknown>;
}

export function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value))
    throw new Error("Upstream response data must be an array");
  return value.map(record);
}

export function asNumber(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

export function formatTimestamp(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return asString(value);
  const microseconds =
    numeric > 10_000_000_000_000
      ? Math.trunc(numeric)
      : Math.trunc(numeric * 1000);
  const date = new Date(Math.trunc(microseconds / 1000));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const fraction = String(Math.abs(microseconds % 1_000_000)).padStart(6, "0");
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}.${fraction}`;
}

export function formatShioajiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}.${milliseconds}000`;
}
