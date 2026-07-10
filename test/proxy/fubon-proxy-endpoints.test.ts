import { describe, expect, test } from "bun:test";
import {
  FUBON_PROXY_ENDPOINTS,
  matchFubonProxyEndpoint,
} from "../../src/proxy/fubon-proxy-endpoints.ts";

describe("FUBON_PROXY_ENDPOINTS", () => {
  test("registers every route with the proxy prefix and kebab-case segments", () => {
    expect(FUBON_PROXY_ENDPOINTS.size).toBe(104);

    for (const path of FUBON_PROXY_ENDPOINTS.keys()) {
      expect(path).toMatch(
        /^\/proxy\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/,
      );
    }
  });

  test("uses GET for queries and POST for resource changes", () => {
    expect(
      FUBON_PROXY_ENDPOINTS.get(
        "/proxy/market-data/intraday/ticker",
      )?.httpMethod,
    ).toBe("GET");
    expect(
      FUBON_PROXY_ENDPOINTS.get(
        "/proxy/trading/account-management/balance",
      )?.httpMethod,
    ).toBe("GET");
    expect(
      FUBON_PROXY_ENDPOINTS.get(
        "/proxy/trading/trade/place-order",
      )?.httpMethod,
    ).toBe("POST");
    expect(
      FUBON_PROXY_ENDPOINTS.get(
        "/proxy/smart-condition/cancel-condition",
      )?.httpMethod,
    ).toBe("POST");
  });

  test("matches documented market data path parameters", () => {
    const ticker = matchFubonProxyEndpoint(
      "/proxy/market-data/intraday/ticker/2330",
    );
    const quotes = matchFubonProxyEndpoint(
      "/proxy/market-data/snapshot/quotes/TSE",
    );

    expect(ticker?.endpoint).toBe(
      FUBON_PROXY_ENDPOINTS.get("/proxy/market-data/intraday/ticker"),
    );
    expect(ticker?.pathParameters).toEqual({ symbol: "2330" });
    expect(quotes?.endpoint).toBe(
      FUBON_PROXY_ENDPOINTS.get("/proxy/market-data/snapshot/quotes"),
    );
    expect(quotes?.pathParameters).toEqual({ market: "TSE" });
  });

  test("matches every documented market data route with a path parameter", () => {
    const templates: Array<[string, string, string]> = [
      ["/proxy/market-data/intraday/ticker/2330", "symbol", "2330"],
      ["/proxy/market-data/intraday/quote/2330", "symbol", "2330"],
      ["/proxy/market-data/intraday/candles/2330", "symbol", "2330"],
      ["/proxy/market-data/intraday/trades/2330", "symbol", "2330"],
      ["/proxy/market-data/intraday/volumes/2330", "symbol", "2330"],
      ["/proxy/market-data/historical/candles/2330", "symbol", "2330"],
      ["/proxy/market-data/historical/stats/2330", "symbol", "2330"],
      ["/proxy/market-data/snapshot/quotes/TSE", "market", "TSE"],
      ["/proxy/market-data/snapshot/movers/TSE", "market", "TSE"],
      ["/proxy/market-data/snapshot/actives/TSE", "market", "TSE"],
      ["/proxy/market-data/technical/bb/2330", "symbol", "2330"],
      ["/proxy/market-data/technical/kdj/2330", "symbol", "2330"],
      ["/proxy/market-data/technical/macd/2330", "symbol", "2330"],
      ["/proxy/market-data/technical/rsi/2330", "symbol", "2330"],
      ["/proxy/market-data/technical/sma/2330", "symbol", "2330"],
      [
        "/proxy/market-data-future/intraday/quote/TXFC5",
        "symbol",
        "TXFC5",
      ],
      [
        "/proxy/market-data-future/intraday/candles/TXFC5",
        "symbol",
        "TXFC5",
      ],
      [
        "/proxy/market-data-future/intraday/trades/TXFC5",
        "symbol",
        "TXFC5",
      ],
      [
        "/proxy/market-data-future/intraday/volumes/TXFC5",
        "symbol",
        "TXFC5",
      ],
    ];

    for (const [path, name, value] of templates) {
      expect(matchFubonProxyEndpoint(path)?.pathParameters).toEqual({
        [name]: value,
      });
    }
  });
});
