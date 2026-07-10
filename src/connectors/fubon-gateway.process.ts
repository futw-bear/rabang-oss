import { FubonSDK, type Account } from "fubon-neo";
import {
  isFubonGatewayRequest,
  type AnyFubonGatewayRequest,
  type FubonCredentials,
  type FubonGatewayEvent,
  type FubonGatewayResponse,
} from "./fubon-gateway-protocol.ts";
import type { FubonProxyTarget } from "../proxy/fubon-proxy-types.ts";

let sdk: FubonSDK | undefined;
let accounts: Account[] = [];

const TEST_ENVIRONMENT_URL = "wss://neoapitest.fbs.com.tw/TASP/XCPXWS";

process.on("message", (message: unknown) => {
  if (!isFubonGatewayRequest(message)) {
    return;
  }

  void handleRequest(message);
});
process.on("disconnect", shutdown);

process.send?.({ type: "ready" });

async function handleRequest(request: AnyFubonGatewayRequest): Promise<void> {
  try {
    switch (request.method) {
      case "login":
        sendSuccess(request.id, login(request.payload.credentials));
        return;
      case "getAccounts":
        ensureConnected();
        sendSuccess(request.id, { accounts });
        return;
      case "logout":
        sendSuccess(request.id, { success: logout() });
        return;
      case "invoke":
        sendSuccess(
          request.id,
          await invokeProxy(
            request.payload.target,
            request.payload.arguments,
          ),
        );
        return;
    }
  } catch (error) {
    sendFailure(request.id, error);
  }
}

function login(credentials: FubonCredentials): { accounts: Account[] } {
  logout();
  sdk = credentials.testEnvironment
    ? new FubonSDK(30, 2, TEST_ENVIRONMENT_URL)
    : new FubonSDK();

  const result =
    credentials.method === "password"
      ? sdk.login(
          credentials.personalId,
          credentials.password,
          credentials.certPath,
          credentials.certPassword,
        )
      : sdk.apikeyLogin(
          credentials.personalId,
          credentials.apiKey,
          credentials.certPath,
          credentials.certPassword,
        );

  if (!result.isSuccess) {
    sdk = undefined;
    throw new Error(result.message ?? "Fubon login failed");
  }

  accounts = result.data ?? [];
  sdk.initRealtime();
  sdk.setOnEvent((code, message) => {
    const event: FubonGatewayEvent = {
      type: "event",
      event: "sdk",
      data: { code, message },
    };
    process.send?.(event);
  });

  return { accounts };
}

async function invokeProxy(
  target: FubonProxyTarget,
  arguments_: unknown[],
): Promise<unknown> {
  ensureConnected();

  if (!sdk) {
    throw new Error("Fubon SDK is not connected");
  }

  let receiver: unknown;

  switch (target.service) {
    case "stock":
      receiver = sdk.stock;
      break;
    case "accounting":
      receiver = sdk.accounting;
      break;
    case "futopt":
      receiver = sdk.futopt;
      break;
    case "futoptAccounting":
      receiver = sdk.futoptAccounting;
      break;
    case "marketDataStock":
      receiver = sdk.marketdata.restClient.stock;
      break;
    case "marketDataFutopt":
      receiver = sdk.marketdata.restClient.futopt;
      break;
  }

  for (const segment of target.methodPath.slice(0, -1)) {
    receiver = readProperty(receiver, segment);
  }

  const methodName = target.methodPath.at(-1);
  if (!methodName) {
    throw new Error("Fubon proxy target has no method");
  }

  const method = readProperty(receiver, methodName);
  if (typeof method !== "function") {
    throw new Error(`Fubon proxy target is not callable: ${methodName}`);
  }

  return await method.apply(receiver, arguments_);
}

function readProperty(value: unknown, property: string): unknown {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    throw new Error(`Fubon proxy target is unavailable: ${property}`);
  }

  return Reflect.get(value, property);
}

function logout(): boolean {
  if (!sdk) {
    accounts = [];
    return true;
  }

  sdk.setOnEvent(() => {});
  const success = sdk.logout();
  sdk = undefined;
  accounts = [];
  return success;
}

function ensureConnected(): void {
  if (!sdk) {
    throw new Error("Fubon SDK is not connected");
  }
}

function sendSuccess(id: string, data: unknown): void {
  const response: FubonGatewayResponse = {
    type: "response",
    id,
    ok: true,
    data,
  };
  process.send?.(response);
}

function sendFailure(id: string, error: unknown): void {
  const response: FubonGatewayResponse = {
    type: "response",
    id,
    ok: false,
    error: {
      code: "FUBON_GATEWAY_ERROR",
      message: error instanceof Error ? error.message : "Unknown gateway error",
    },
  };
  process.send?.(response);
}

function shutdown(): void {
  try {
    logout();
  } finally {
    process.exit(0);
  }
}
