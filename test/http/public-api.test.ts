import { describe, expect, test } from "bun:test";
import {
  createPublicApiRequestHandler,
  secondsUntilNextPricesRefresh,
  secondsUntilNextSecuritiesRefresh,
} from "../../src/http/public-api.ts";

const SECURITIES_URL =
  "https://raw.githubusercontent.com/futw-bear/securities-list/refs/heads/main/data/parsed/securities.json";
const TSE_PRICES_URL =
  "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const OTC_PRICES_URL =
  "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes";

describe("GET /api/pub/securities", () => {
  test("returns the upstream securities resource with public cache headers", async () => {
    const requests: Array<{ input: string | URL | Request; init?: RequestInit }> =
      [];
    const handler = createPublicApiRequestHandler({
      fetch: async (input, init) => {
        requests.push({ input, init });
        return Response.json([{ code: "2330", name: "TSMC" }]);
      },
      now: () => new Date("2026-07-13T21:59:30.000Z"),
    });

    const response = await handler(
      new Request("http://localhost/api/pub/securities"),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response?.headers.get("Cache-Control")).toBe(
      "public, max-age=30, s-maxage=30",
    );
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response?.json()).toEqual([{ code: "2330", name: "TSMC" }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(SECURITIES_URL);
    expect(requests[0]?.init?.headers).toEqual({ Accept: "application/json" });
  });

  test("returns 405 for methods other than GET", async () => {
    let fetched = false;
    const handler = createPublicApiRequestHandler({
      fetch: async () => {
        fetched = true;
        return Response.json([]);
      },
    });

    const response = await handler(
      new Request("http://localhost/api/pub/securities", { method: "POST" }),
    );

    expect(response?.status).toBe(405);
    expect(response?.headers.get("Allow")).toBe("GET");
    expect(fetched).toBe(false);
  });

  test("returns 502 when the upstream request fails", async () => {
    const handler = createPublicApiRequestHandler({
      fetch: async () => new Response("Unavailable", { status: 503 }),
    });

    const response = await handler(
      new Request("http://localhost/api/pub/securities"),
    );

    expect(response?.status).toBe(502);
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(await response?.json()).toEqual({ status: "upstream_unavailable" });
  });

  test("does not handle other paths", async () => {
    const handler = createPublicApiRequestHandler();

    expect(await handler(new Request("http://localhost/api/pub/other"))).toBe(
      undefined,
    );
  });
});

describe("GET /api/pub/prices", () => {
  test.each([
    ["TSE", TSE_PRICES_URL],
    ["OTC", OTC_PRICES_URL],
  ])(
    "returns %s prices from the corresponding upstream",
    async (market, upstreamUrl) => {
      const requests: Array<{
        input: string | URL | Request;
        init?: RequestInit;
      }> = [];
      const handler = createPublicApiRequestHandler({
        fetch: async (input, init) => {
          requests.push({ input, init });
          return Response.json([{ Code: "2330", ClosingPrice: "1100.00" }]);
        },
        now: () => new Date("2026-07-13T05:59:30.000Z"),
      });

      const response = await handler(
        new Request(`http://localhost/api/pub/prices?market=${market}`),
      );

      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe(
        "application/json; charset=utf-8",
      );
      expect(response?.headers.get("Cache-Control")).toBe(
        "public, max-age=30, s-maxage=30",
      );
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await response?.json()).toEqual([
        { Code: "2330", ClosingPrice: "1100.00" },
      ]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.input).toBe(upstreamUrl);
      expect(requests[0]?.init?.headers).toEqual({
        Accept: "application/json",
      });
    },
  );

  test.each(["", "TWSE", "tse"])(
    "returns 400 for unsupported market value %p",
    async (market) => {
      let fetched = false;
      const handler = createPublicApiRequestHandler({
        fetch: async () => {
          fetched = true;
          return Response.json([]);
        },
      });

      const response = await handler(
        new Request(`http://localhost/api/pub/prices?market=${market}`),
      );

      expect(response?.status).toBe(400);
      expect(response?.headers.get("Cache-Control")).toBe("no-store");
      expect(await response?.json()).toEqual({
        status: "invalid_request",
        message: "market must be TSE or OTC",
      });
      expect(fetched).toBe(false);
    },
  );

  test("returns 400 when market is missing", async () => {
    const handler = createPublicApiRequestHandler();
    const response = await handler(
      new Request("http://localhost/api/pub/prices"),
    );

    expect(response?.status).toBe(400);
  });

  test("returns 405 for methods other than GET", async () => {
    const handler = createPublicApiRequestHandler();
    const response = await handler(
      new Request("http://localhost/api/pub/prices?market=TSE", {
        method: "POST",
      }),
    );

    expect(response?.status).toBe(405);
    expect(response?.headers.get("Allow")).toBe("GET");
  });

  test("returns 502 without caching when the upstream request fails", async () => {
    const handler = createPublicApiRequestHandler({
      fetch: async () => new Response("Unavailable", { status: 503 }),
    });
    const response = await handler(
      new Request("http://localhost/api/pub/prices?market=OTC"),
    );

    expect(response?.status).toBe(502);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(await response?.json()).toEqual({ status: "upstream_unavailable" });
  });
});

describe("secondsUntilNextSecuritiesRefresh", () => {
  test("expires at the upcoming 06:00 in Asia/Taipei", () => {
    expect(
      secondsUntilNextSecuritiesRefresh(
        new Date("2026-07-13T21:59:30.000Z"),
      ),
    ).toBe(30);
  });

  test("expires at 06:00 the following day after today's refresh", () => {
    expect(
      secondsUntilNextSecuritiesRefresh(
        new Date("2026-07-13T22:00:00.000Z"),
      ),
    ).toBe(86400);
  });
});

describe("secondsUntilNextPricesRefresh", () => {
  test("expires at the upcoming 14:00 in Asia/Taipei", () => {
    expect(
      secondsUntilNextPricesRefresh(new Date("2026-07-13T05:59:30.000Z")),
    ).toBe(30);
  });

  test("expires at 14:00 the following day after today's refresh", () => {
    expect(
      secondsUntilNextPricesRefresh(new Date("2026-07-13T06:00:00.000Z")),
    ).toBe(86400);
  });
});
