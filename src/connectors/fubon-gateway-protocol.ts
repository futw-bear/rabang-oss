import type { FubonProxyInvocation } from "../proxy/fubon-proxy-types.ts";

export interface FubonAccount {
  name: string;
  branchNo: string;
  account: string;
  accountType: string;
}

interface BaseFubonCredentials {
  personalId: string;
  certPath: string;
  certPassword: string;
  testEnvironment?: boolean;
}

export interface FubonPasswordCredentials extends BaseFubonCredentials {
  method: "password";
  password: string;
}

export interface FubonApiKeyCredentials extends BaseFubonCredentials {
  method: "apiKey";
  apiKey: string;
}

export type FubonCredentials =
  | FubonPasswordCredentials
  | FubonApiKeyCredentials;

export interface FubonGatewayCommandMap {
  login: {
    request: { credentials: FubonCredentials };
    response: { accounts: FubonAccount[] };
  };
  getAccounts: {
    request: Record<string, never>;
    response: { accounts: FubonAccount[] };
  };
  logout: {
    request: Record<string, never>;
    response: { success: boolean };
  };
  invoke: {
    request: FubonProxyInvocation;
    response: unknown;
  };
}

export type FubonGatewayMethod = keyof FubonGatewayCommandMap;

export type FubonGatewayRequest<M extends FubonGatewayMethod> = {
  type: "request";
  id: string;
  method: M;
  payload: FubonGatewayCommandMap[M]["request"];
};

export type AnyFubonGatewayRequest = {
  [M in FubonGatewayMethod]: FubonGatewayRequest<M>;
}[FubonGatewayMethod];

export type FubonGatewayResponse =
  | {
      type: "response";
      id: string;
      ok: true;
      data: unknown;
    }
  | {
      type: "response";
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export type FubonGatewayEvent = {
  type: "event";
  event: "sdk";
  data: {
    code: string;
    message: string;
  };
};

export type FubonGatewayReady = { type: "ready" };

export type FubonGatewayMessage =
  | FubonGatewayReady
  | FubonGatewayResponse
  | FubonGatewayEvent;

export function isFubonGatewayRequest(
  value: unknown,
): value is AnyFubonGatewayRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<AnyFubonGatewayRequest>;
  return (
    request.type === "request" &&
    typeof request.id === "string" &&
    (request.method === "login" ||
      request.method === "getAccounts" ||
      request.method === "logout" ||
      request.method === "invoke") &&
    typeof request.payload === "object" &&
    request.payload !== null
  );
}

export function isFubonGatewayMessage(
  value: unknown,
): value is FubonGatewayMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Partial<FubonGatewayMessage>;

  if (message.type === "ready") {
    return true;
  }

  if (message.type === "response") {
    const response = message as FubonGatewayResponse;
    return (
      typeof response.id === "string" &&
      typeof response.ok === "boolean" &&
      (response.ok ||
        (typeof response.error?.code === "string" &&
          typeof response.error.message === "string"))
    );
  }

  if (message.type === "event") {
    const event = message as FubonGatewayEvent;
    return (
      event.event === "sdk" &&
      typeof event.data?.code === "string" &&
      typeof event.data.message === "string"
    );
  }

  return false;
}
