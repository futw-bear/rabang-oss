import { describe, expect, test } from "bun:test";
import { FUBON_PROXY_ENDPOINTS } from "../../src/proxy/fubon-proxy-endpoints.ts";

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
});
