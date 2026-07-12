import type { FubonAccount } from "../connectors/fubon-connector.ts";
import type { Connector } from "../connectors/connector.ts";

export const BRIDGE_PREFIX = "/bridge";

type BridgeConnector = Connector & {
  readonly accounts: readonly FubonAccount[];
};

interface FubonResult<T> {
  isSuccess: boolean;
  data?: T;
  message?: string;
}

interface FubonBankRemain {
  availableBalance: number | string;
}

class BridgeRequestError extends Error {}

export function createBridgeRequestHandler(
  connector: BridgeConnector,
  now: () => Date = () => new Date(),
): (request: Request) => Promise<Response | undefined> {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${BRIDGE_PREFIX}/`)) {
      return undefined;
    }

    const bridgePath = url.pathname.slice(BRIDGE_PREFIX.length);
    if (bridgePath === "/api/v1/portfolio/account_balance") {
      if (request.method !== "POST") {
        return bridgeError(405, "Method not allowed", null, {
          Allow: "POST",
        });
      }

      if (connector.status !== "connected") {
        return bridgeError(503, "Fubon gateway is not connected");
      }

      try {
        const body = await readAccountRequest(request);
        const account = selectStockAccount(connector.accounts, body);
        const result = await connector.invokeProxy({
          target: { service: "accounting", methodPath: ["bankRemain"] },
          arguments: [account],
        });

        return Response.json(toAccountBalance(result, now()));
      } catch (error) {
        if (error instanceof BridgeRequestError) {
          return bridgeError(400, error.message);
        }

        return bridgeError(
          500,
          error instanceof Error ? error.message : "Unknown bridge error",
        );
      }
    }

    if (bridgePath.startsWith("/api/v1/")) {
      return bridgeError(
        501,
        `Shioaji bridge endpoint is not implemented: ${bridgePath}`,
      );
    }

    return bridgeError(404, "Not found");
  };
}

interface AccountRequest {
  account_type?: "S";
  broker_id?: string;
  account_id?: string;
  person_id?: string | null;
}

async function readAccountRequest(request: Request): Promise<AccountRequest> {
  let value: unknown;

  try {
    value = await request.json();
  } catch {
    throw new BridgeRequestError("Request body must contain valid JSON");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BridgeRequestError("Request body must be a JSON object");
  }

  const body = value as Record<string, unknown>;
  const allowedFields = new Set([
    "account_type",
    "broker_id",
    "account_id",
    "person_id",
  ]);
  const unknownField = Object.keys(body).find(
    (field) => !allowedFields.has(field),
  );
  if (unknownField) {
    throw new BridgeRequestError(`Unknown field: ${unknownField}`);
  }

  if (body.account_type !== undefined && body.account_type !== "S") {
    throw new BridgeRequestError('account_type must be "S"');
  }
  assertOptionalString(body, "broker_id");
  assertOptionalString(body, "account_id");
  if (
    body.person_id !== undefined &&
    body.person_id !== null &&
    typeof body.person_id !== "string"
  ) {
    throw new BridgeRequestError("person_id must be a string or null");
  }
  if (typeof body.person_id === "string") {
    throw new BridgeRequestError(
      "person_id account selection is unavailable from Fubon login data",
    );
  }

  return body as AccountRequest;
}

function assertOptionalString(
  body: Record<string, unknown>,
  field: "broker_id" | "account_id",
): void {
  if (body[field] !== undefined && typeof body[field] !== "string") {
    throw new BridgeRequestError(`${field} must be a string`);
  }
}

function selectStockAccount(
  accounts: readonly FubonAccount[],
  request: AccountRequest,
): FubonAccount {
  const account = accounts.find(
    (candidate) =>
      candidate.accountType === "stock" &&
      (request.broker_id === undefined ||
        candidate.branchNo === request.broker_id) &&
      (request.account_id === undefined ||
        candidate.account === request.account_id),
  );

  if (!account) {
    throw new BridgeRequestError("Requested stock account is unavailable");
  }

  return account;
}

function toAccountBalance(
  result: unknown,
  queryTime: Date,
): {
  acc_balance: number;
  date: string;
  errmsg: string;
} {
  if (!isFubonResult<FubonBankRemain>(result)) {
    throw new Error("Fubon bankRemain returned an invalid response");
  }

  if (!result.isSuccess) {
    return {
      acc_balance: 0,
      date: formatShioajiDate(queryTime),
      errmsg: result.message ?? "Fubon bank balance query failed",
    };
  }

  const balance = Number(result.data?.availableBalance);
  if (!Number.isFinite(balance)) {
    throw new Error("Fubon bankRemain returned an invalid availableBalance");
  }

  return {
    acc_balance: balance,
    date: formatShioajiDate(queryTime),
    errmsg: "",
  };
}

function isFubonResult<T>(value: unknown): value is FubonResult<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<FubonResult<T>>).isSuccess === "boolean"
  );
}

function formatShioajiDate(date: Date): string {
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

function bridgeError(
  status: number,
  message: string,
  details: unknown = null,
  headers?: Record<string, string>,
): Response {
  return Response.json({ code: status, message, details }, { status, headers });
}
