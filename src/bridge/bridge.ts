import {
  type BridgeConnector,
  bridgeError,
  BridgeHttpError,
  readJsonObject,
  unsupported,
} from "./common.ts";
import { LocalBridgeApi } from "./local-api.ts";
import { handleMarketData } from "./market-data.ts";
import { handleOrders } from "./orders.ts";
import { handlePortfolio } from "./portfolio.ts";
import { BridgeStreaming } from "./streaming.ts";

export const BRIDGE_PREFIX = "/bridge";

export const BRIDGE_ENDPOINT_METHODS: ReadonlyMap<string, string> = new Map([
  ["/openapi.json", "GET"],
  ["/api/v1/health", "GET"],
  ["/api/v1/info", "GET"],
  ["/api/v1/auth/usage", "GET"],
  ["/api/v1/auth/accounts", "GET"],
  ["/api/v1/auth/ca_expiretime", "GET"],
  ["/api/v1/auth/subscribe_trade", "POST"],
  ["/api/v1/auth/unsubscribe_trade", "POST"],
  ["/api/v1/data/snapshots", "POST"],
  ["/api/v1/data/ticks", "POST"],
  ["/api/v1/data/kbars", "POST"],
  ["/api/v1/data/daily_quotes", "POST"],
  ["/api/v1/data/credit_enquire", "POST"],
  ["/api/v1/data/scanner", "POST"],
  ["/api/v1/data/regulatory_punish", "GET"],
  ["/api/v1/data/regulatory_notice", "GET"],
  ["/api/v1/data/short_stock_sources", "POST"],
  ["/api/v1/data/contracts", "POST"],
  ["/api/v1/order/place_order", "POST"],
  ["/api/v1/order/cancel_order", "POST"],
  ["/api/v1/order/update_price", "POST"],
  ["/api/v1/order/update_qty", "POST"],
  ["/api/v1/order/trades", "POST"],
  ["/api/v1/order/place_comboorder", "POST"],
  ["/api/v1/order/cancel_comboorder", "POST"],
  ["/api/v1/order/combotrades", "POST"],
  ["/api/v1/order/stock_reserve_summary", "POST"],
  ["/api/v1/order/stock_reserve_detail", "POST"],
  ["/api/v1/order/reserve_stock", "POST"],
  ["/api/v1/order/earmarking_detail", "POST"],
  ["/api/v1/order/reserve_earmarking", "POST"],
  ["/api/v1/order/order_deal_records", "POST"],
  ["/api/v1/portfolio/account_balance", "POST"],
  ["/api/v1/portfolio/margin", "POST"],
  ["/api/v1/portfolio/position_unit", "POST"],
  ["/api/v1/portfolio/position_detail", "POST"],
  ["/api/v1/portfolio/settlements", "POST"],
  ["/api/v1/portfolio/settlement", "POST"],
  ["/api/v1/portfolio/trading_limits", "POST"],
  ["/api/v1/portfolio/profit_loss", "POST"],
  ["/api/v1/portfolio/profit_loss_detail", "POST"],
  ["/api/v1/portfolio/profitloss_sum", "POST"],
  ["/api/v1/stream/subscribe", "POST"],
  ["/api/v1/stream/unsubscribe", "POST"],
  ["/api/v1/stream/receivers", "GET"],
  ["/api/v1/stream/status", "GET"],
  ["/api/v1/stream/data", "GET"],
  ["/api/v1/stream/data/tick_stk", "GET"],
  ["/api/v1/stream/data/bidask_stk", "GET"],
  ["/api/v1/stream/data/tick_fop", "GET"],
  ["/api/v1/stream/data/bidask_fop", "GET"],
  ["/api/v1/stream/data/quote_stk", "GET"],
  ["/api/v1/stream/data/quote_fop", "GET"],
  ["/api/v1/stream/data/order_event", "GET"],
  ["/api/v1/watchlist", "GET, POST"],
  ["/api/v1/apps", "GET"],
]);

export function createBridgeRequestHandler(
  connector: BridgeConnector,
  now: () => Date = () => new Date(),
): (request: Request) => Promise<Response | undefined> {
  const local = new LocalBridgeApi();
  const streaming = new BridgeStreaming(connector, now);

  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${BRIDGE_PREFIX}/`)) return undefined;
    const path = url.pathname.slice(BRIDGE_PREFIX.length);

    try {
      const allowed = allowedMethods(path);
      if (!allowed) throw new BridgeHttpError(404, "Not found");
      if (!allowed.includes(request.method)) {
        return bridgeError(405, "Method not allowed", null, {
          Allow: allowed.join(", "),
        });
      }

      if (path === "/openapi.json") {
        return Response.json(createOpenApiDocument(url.origin));
      }

      if (path === "/api/v1/health") {
        return Response.json(
          {
            status: connector.status === "connected" ? "healthy" : "unhealthy",
            version: "bridge-1.0.0",
            timestamp: now().toISOString(),
            token_expires_in_seconds: null,
            token_stale: null,
            contract_count: null,
            next_maintenance: null,
            ca_expires_in_days: null,
            ca_expired: null,
          },
          { status: connector.status === "connected" ? 200 : 503 },
        );
      }
      if (path === "/api/v1/info") {
        return Response.json({
          name: "Rabang Shioaji API Bridge",
          version: "1.0.0",
          description: "Shioaji-compatible HTTP API backed by Fubon Neo",
          protocols: ["HTTP", "SSE"],
          simulation: connector.simulation ?? null,
        });
      }
      if (path.startsWith("/apps/")) return local.serveApp(path);

      if (connector.status !== "connected") {
        throw new BridgeHttpError(503, "Fubon gateway is not connected");
      }
      if (path === "/api/v1/auth/accounts") {
        return Response.json(
          connector.accounts.map((account) => ({
            account_type: account.accountType === "futopt" ? "F" : "S",
            broker_id: account.branchNo,
            account_id: account.account,
            signed: true,
            username: account.name,
          })),
        );
      }
      if (path === "/api/v1/auth/usage") {
        unsupported(
          path,
          "Fubon does not expose Shioaji connection and traffic usage statistics",
        );
      }
      if (path === "/api/v1/auth/ca_expiretime") {
        unsupported(path, "Fubon does not expose a certificate-expiry query");
      }
      if (
        path === "/api/v1/auth/subscribe_trade" ||
        path === "/api/v1/auth/unsubscribe_trade"
      ) {
        if (connector.simulation && path === "/api/v1/auth/unsubscribe_trade") {
          throw new BridgeHttpError(
            400,
            "Trade-event unsubscribe is unavailable in simulation mode",
          );
        }
        const body = await readJsonObject(request);
        return await streaming.tradeSubscription(
          path === "/api/v1/auth/subscribe_trade",
          body,
        );
      }
      if (path.startsWith("/api/v1/data/"))
        return await handleMarketData(connector, path, request, now);
      if (path.startsWith("/api/v1/order/"))
        return await handleOrders(connector, path, request);
      if (path.startsWith("/api/v1/portfolio/"))
        return await handlePortfolio(connector, path, request, now);
      if (path.startsWith("/api/v1/stream/"))
        return await streaming.handle(path, request);
      if (path.startsWith("/api/v1/watchlist"))
        return await local.watchlist(path, request);
      if (path.startsWith("/api/v1/apps"))
        return await local.apps(path, request);
      throw new BridgeHttpError(404, "Not found");
    } catch (error) {
      if (error instanceof BridgeHttpError) {
        return bridgeError(error.status, error.message, error.details);
      }
      return bridgeError(
        500,
        error instanceof Error ? error.message : "Unknown bridge error",
      );
    }
  };
}

function allowedMethods(path: string): string[] | undefined {
  const exact = BRIDGE_ENDPOINT_METHODS.get(path);
  if (exact) return exact.split(", ");
  if (/^\/api\/v1\/data\/contracts\/[^/]+$/.test(path)) return ["GET"];
  if (/^\/api\/v1\/watchlist\/[^/]+$/.test(path))
    return ["GET", "PUT", "DELETE"];
  if (/^\/api\/v1\/watchlist\/[^/]+\/contracts$/.test(path))
    return ["POST", "DELETE"];
  if (/^\/api\/v1\/apps\/[^/]+$/.test(path)) return ["POST", "DELETE"];
  if (path.startsWith("/apps/")) return ["GET"];
  return undefined;
}

function createOpenApiDocument(origin: string): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const [path, methods] of BRIDGE_ENDPOINT_METHODS) {
    if (!path.startsWith("/api/")) continue;
    paths[`${BRIDGE_PREFIX}${path}`] = Object.fromEntries(
      methods.split(", ").map((method) => [
        method.toLowerCase(),
        {
          operationId: `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]+/g, "_")}`,
          responses: {
            "200": { description: "Success" },
            "501": { description: "No equivalent Fubon capability" },
          },
        },
      ]),
    );
  }
  for (const [path, methods] of [
    ["/bridge/api/v1/data/contracts/{code}", ["get"]],
    ["/bridge/api/v1/watchlist/{id}", ["get", "put", "delete"]],
    ["/bridge/api/v1/watchlist/{id}/contracts", ["post", "delete"]],
    ["/bridge/api/v1/apps/{name}", ["post", "delete"]],
    ["/bridge/apps/{path}", ["get"]],
  ] as const) {
    paths[path] = Object.fromEntries(
      methods.map((method) => [
        method,
        {
          operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, "_")}`,
          responses: { "200": { description: "Success" } },
        },
      ]),
    );
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Rabang Shioaji API Bridge",
      version: "1.0.0",
      description: "Shioaji-compatible endpoints backed by Fubon Neo",
    },
    servers: [{ url: origin }],
    paths,
  };
}
