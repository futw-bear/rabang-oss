import type {
  FubonProxyInvocation,
  MarketDataWebSocketMessage,
  MarketDataWebSocketMode,
} from "../proxy/fubon-proxy-types.ts";

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
  FubonPasswordCredentials | FubonApiKeyCredentials;

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
  openMarketDataWebSocket: {
    request: {
      id: string;
      mode: MarketDataWebSocketMode;
      product?: "stock" | "futopt";
    };
    response: Record<string, never>;
  };
  sendMarketDataWebSocket: {
    request: MarketDataWebSocketMessage;
    response: Record<string, never>;
  };
  closeMarketDataWebSocket: {
    request: { id: string };
    response: Record<string, never>;
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

export type FubonGatewayEvent =
  | {
      type: "event";
      event: "sdk";
      data: { code: string; message: string };
    }
  | {
      type: "event";
      event: "marketDataWebSocket";
      data: MarketDataWebSocketMessage;
    }
  | {
      type: "event";
      event: "marketDataHeartbeatTimeout";
      data: { timeoutMs: number };
    }
  | {
      type: "event";
      event: "trading";
      data: {
        kind: "order" | "orderChanged" | "filled";
        code: string;
        content: unknown;
      };
    };

export type FubonGatewayReady = { type: "ready" };

export type FubonGatewayMessage =
  FubonGatewayReady | FubonGatewayResponse | FubonGatewayEvent;

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
      request.method === "invoke" ||
      request.method === "openMarketDataWebSocket" ||
      request.method === "sendMarketDataWebSocket" ||
      request.method === "closeMarketDataWebSocket") &&
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
    if (event.event === "sdk") {
      return (
        typeof event.data?.code === "string" &&
        typeof event.data.message === "string"
      );
    }

    if (event.event === "marketDataWebSocket") {
      return (
        typeof event.data?.id === "string" &&
        typeof event.data.message === "string"
      );
    }

    if (event.event === "trading") {
      return (
        (event.data?.kind === "order" ||
          event.data?.kind === "orderChanged" ||
          event.data?.kind === "filled") &&
        typeof event.data.code === "string"
      );
    }

    return (
      event.event === "marketDataHeartbeatTimeout" &&
      typeof event.data?.timeoutMs === "number"
    );
  }

  return false;
}
