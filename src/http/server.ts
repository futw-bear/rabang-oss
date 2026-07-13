import type { Connector } from "../connectors/connector.ts";
import type { FubonAccount } from "../connectors/fubon-connector.ts";
import { createRequestHandler } from "./app.ts";
import { SqliteOrderStore } from "../bridge/order-store.ts";
import {
  MarketDataWebSocketProxy,
  parseMarketDataWebSocketMode,
  type MarketDataWebSocketConnector,
} from "./market-data-websocket.ts";

const BRIDGE_SSE_PATH = "/bridge/api/v1/stream/data";

export function isBridgeSseRequest(request: Request): boolean {
  if (request.method !== "GET") {
    return false;
  }

  const pathname = new URL(request.url).pathname;
  return (
    pathname === BRIDGE_SSE_PATH || pathname.startsWith(`${BRIDGE_SSE_PATH}/`)
  );
}

export function startHttpServer(
  connector: Connector &
    MarketDataWebSocketConnector & {
      readonly accounts: readonly FubonAccount[];
    },
  port: number,
  databasePath: string,
): ReturnType<typeof Bun.serve> {
  const requestHandler = createRequestHandler(
    connector,
    new SqliteOrderStore(databasePath),
  );
  const marketDataWebSocketProxy = new MarketDataWebSocketProxy(connector);

  return Bun.serve<{ id: string; mode: "speed" | "normal" }>({
    port,
    fetch(request, server) {
      const url = new URL(request.url);

      if (isBridgeSseRequest(request)) {
        server.timeout(request, 0);
      }

      if (url.pathname === "/proxy/market-data/ws") {
        if (request.method !== "GET") {
          return Response.json(
            { status: "method_not_allowed" },
            { status: 405, headers: { Allow: "GET" } },
          );
        }

        if (connector.status !== "connected") {
          return Response.json({ status: "attempting" }, { status: 503 });
        }

        const mode = parseMarketDataWebSocketMode(url.searchParams.get("mode"));
        if (!mode) {
          return Response.json(
            {
              status: "invalid_request",
              message: "mode must be speed or normal",
            },
            { status: 400 },
          );
        }

        if (
          server.upgrade(request, {
            data: { id: crypto.randomUUID(), mode },
          })
        ) {
          return;
        }

        return Response.json({ status: "upgrade_required" }, { status: 426 });
      }

      return requestHandler(request);
    },
    websocket: {
      open(socket) {
        marketDataWebSocketProxy.open(socket);
      },
      message(socket, message) {
        void marketDataWebSocketProxy.message(socket, message);
      },
      close(socket) {
        marketDataWebSocketProxy.close(socket);
      },
    },
  });
}
