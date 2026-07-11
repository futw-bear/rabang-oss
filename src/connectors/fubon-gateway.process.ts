import { FubonSDK, Mode, type Account } from "fubon-neo";
import {
  isFubonGatewayRequest,
  type AnyFubonGatewayRequest,
  type FubonCredentials,
  type FubonGatewayEvent,
  type FubonGatewayResponse,
} from "./fubon-gateway-protocol.ts";
import type { FubonProxyTarget } from "../proxy/fubon-proxy-types.ts";
import type { MarketDataWebSocketMode } from "../proxy/fubon-proxy-types.ts";
import {
  isMarketDataHeartbeat,
  MARKET_DATA_HEARTBEAT_TIMEOUT_MS,
  MarketDataHeartbeatWatchdog,
} from "./market-data-heartbeat.ts";

let sdk: FubonSDK | undefined;
let accounts: Account[] = [];
const marketDataWebSockets = new Map<string, MarketDataWebSocketSession>();
let heartbeatSession: MarketDataHeartbeatSession | undefined;

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
        sendSuccess(request.id, await login(request.payload.credentials));
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
      case "openMarketDataWebSocket":
        await openMarketDataWebSocket(request.payload.id, request.payload.mode);
        sendSuccess(request.id, {});
        return;
      case "sendMarketDataWebSocket":
        await sendMarketDataWebSocket(
          request.payload.id,
          request.payload.message,
        );
        sendSuccess(request.id, {});
        return;
      case "closeMarketDataWebSocket":
        closeMarketDataWebSocket(request.payload.id);
        sendSuccess(request.id, {});
        return;
    }
  } catch (error) {
    sendFailure(request.id, error);
  }
}

async function login(
  credentials: FubonCredentials,
): Promise<{ accounts: Account[] }> {
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
  try {
    await openMarketDataHeartbeatConnection();
  } catch (error) {
    logout();
    throw error;
  }

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
  closeMarketDataHeartbeatConnection();
  closeAllMarketDataWebSockets();

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

interface MarketDataWebSocketClient {
  connect(): Promise<unknown>;
  disconnect(): unknown;
  on(event: "message", listener: (message: unknown) => void): void;
  off(event: "message", listener: (message: unknown) => void): void;
  subscribe(params: { channel: string; [key: string]: unknown }): void;
  unsubscribe(params: { id?: string; ids?: string[] }): void;
  ping(params: { state?: unknown }): void;
  subscriptions(): void;
}

interface MarketDataHeartbeatSession {
  client: MarketDataWebSocketClient;
  listener: (message: unknown) => void;
  watchdog: MarketDataHeartbeatWatchdog;
}

interface MarketDataWebSocketSession {
  client: MarketDataWebSocketClient;
  listener: (message: unknown) => void;
  ready: Promise<unknown>;
}

async function openMarketDataHeartbeatConnection(): Promise<void> {
  if (!sdk) {
    throw new Error("Fubon SDK is not connected");
  }

  sdk.initRealtime();
  const client = sdk.marketdata.webSocketClient.stock as MarketDataWebSocketClient;
  const watchdog = new MarketDataHeartbeatWatchdog(() => {
    const event: FubonGatewayEvent = {
      type: "event",
      event: "marketDataHeartbeatTimeout",
      data: { timeoutMs: MARKET_DATA_HEARTBEAT_TIMEOUT_MS },
    };
    process.send?.(event);
  });
  const listener = (message: unknown) => {
    if (isMarketDataHeartbeat(message)) {
      watchdog.heartbeat();
    }
  };

  client.on("message", listener);
  heartbeatSession = { client, listener, watchdog };

  try {
    await client.connect();
    watchdog.start();
  } catch (error) {
    closeMarketDataHeartbeatConnection();
    throw error;
  }
}

function closeMarketDataHeartbeatConnection(): void {
  if (!heartbeatSession) {
    return;
  }

  const { client, listener, watchdog } = heartbeatSession;
  heartbeatSession = undefined;
  watchdog.stop();
  client.off("message", listener);
  void client.disconnect();
}

async function openMarketDataWebSocket(
  id: string,
  mode: MarketDataWebSocketMode,
): Promise<void> {
  ensureConnected();

  if (!sdk) {
    throw new Error("Fubon SDK is not connected");
  }

  if (marketDataWebSockets.size >= 4) {
    throw new Error("Fubon market data WebSocket connection limit reached");
  }

  sdk.initRealtime(mode === "speed" ? Mode.Speed : Mode.Normal);
  const client = sdk.marketdata.webSocketClient.stock as MarketDataWebSocketClient;
  const listener = (message: unknown) => {
    const event: FubonGatewayEvent = {
      type: "event",
      event: "marketDataWebSocket",
      data: { id, message: String(message) },
    };
    process.send?.(event);
  };
  client.on("message", listener);

  const session: MarketDataWebSocketSession = {
    client,
    listener,
    ready: client.connect(),
  };
  marketDataWebSockets.set(id, session);

  try {
    await session.ready;
  } catch (error) {
    closeMarketDataWebSocket(id);
    throw error;
  }
}

async function sendMarketDataWebSocket(
  id: string,
  rawMessage: string,
): Promise<void> {
  const session = marketDataWebSockets.get(id);
  if (!session) {
    throw new Error("Fubon market data WebSocket is not connected");
  }

  await session.ready;
  const message = parseMarketDataWebSocketCommand(rawMessage);

  switch (message.event) {
    case "subscribe":
      session.client.subscribe(message.data);
      return;
    case "unsubscribe":
      session.client.unsubscribe(message.data);
      return;
    case "ping":
      session.client.ping(message.data);
      return;
    case "subscriptions":
      session.client.subscriptions();
      return;
  }
}

function parseMarketDataWebSocketCommand(rawMessage: string):
  | { event: "subscribe"; data: { channel: string; [key: string]: unknown } }
  | { event: "unsubscribe"; data: { id?: string; ids?: string[] } }
  | { event: "ping"; data: { state?: unknown } }
  | { event: "subscriptions" } {
  let message: unknown;

  try {
    message = JSON.parse(rawMessage);
  } catch {
    throw new Error("Market data WebSocket message must be valid JSON");
  }

  if (typeof message !== "object" || message === null) {
    throw new Error("Market data WebSocket message must be an object");
  }

  const command = message as { event?: unknown; data?: unknown };
  if (command.event === "subscriptions") {
    return { event: "subscriptions" };
  }

  if (typeof command.data !== "object" || command.data === null) {
    throw new Error("Market data WebSocket command data must be an object");
  }

  if (
    command.event !== "subscribe" &&
    command.event !== "unsubscribe" &&
    command.event !== "ping"
  ) {
    throw new Error("Unsupported market data WebSocket event");
  }

  const data = command.data as { channel?: unknown };
  if (command.event === "subscribe" && typeof data.channel !== "string") {
    throw new Error("Market data subscription requires a channel");
  }

  return command as
    | { event: "subscribe"; data: { channel: string; [key: string]: unknown } }
    | { event: "unsubscribe"; data: { id?: string; ids?: string[] } }
    | { event: "ping"; data: { state?: unknown } };
}

function closeMarketDataWebSocket(id: string): void {
  const session = marketDataWebSockets.get(id);
  if (!session) {
    return;
  }

  marketDataWebSockets.delete(id);
  session.client.off("message", session.listener);
  session.client.disconnect();
}

function closeAllMarketDataWebSockets(): void {
  for (const id of marketDataWebSockets.keys()) {
    closeMarketDataWebSocket(id);
  }
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
