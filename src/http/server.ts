import type { Connector } from "../connectors/connector.ts";
import type { FubonAccount } from "../connectors/fubon-connector.ts";
import { createRequestHandler } from "./app.ts";
import {
  MarketDataWebSocketProxy,
  parseMarketDataWebSocketMode,
  type MarketDataWebSocketConnector,
} from "./market-data-websocket.ts";

export function startHttpServer(
  connector: Connector &
    MarketDataWebSocketConnector & {
      readonly accounts: readonly FubonAccount[];
    },
  port: number,
): ReturnType<typeof Bun.serve> {
  const requestHandler = createRequestHandler(connector);
  const marketDataWebSocketProxy = new MarketDataWebSocketProxy(connector);

  return Bun.serve<{ id: string; mode: "speed" | "normal" }>({
    port,
    fetch(request, server) {
      const url = new URL(request.url);

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
            { status: "invalid_request", message: "mode must be speed or normal" },
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
