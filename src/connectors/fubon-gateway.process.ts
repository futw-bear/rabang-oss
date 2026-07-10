import { FubonSDK, type Account } from "fubon-neo";
import {
  isFubonGatewayRequest,
  type AnyFubonGatewayRequest,
  type FubonCredentials,
  type FubonGatewayEvent,
  type FubonGatewayResponse,
} from "./fubon-gateway-protocol.ts";

let sdk: FubonSDK | undefined;
let accounts: Account[] = [];

const TEST_ENVIRONMENT_URL = "wss://neoapitest.fbs.com.tw/TASP/XCPXWS";

process.on("message", (message: unknown) => {
  if (!isFubonGatewayRequest(message)) {
    return;
  }

  handleRequest(message);
});
process.on("disconnect", shutdown);

process.send?.({ type: "ready" });

function handleRequest(request: AnyFubonGatewayRequest): void {
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
