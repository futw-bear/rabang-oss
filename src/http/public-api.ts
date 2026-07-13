const SECURITIES_URL =
  "https://raw.githubusercontent.com/futw-bear/securities-list/refs/heads/main/data/parsed/securities.json";
const PRICE_URLS = {
  TSE: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  OTC: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes",
} as const;
const TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const SECURITIES_REFRESH_HOUR = 6;
const PRICES_REFRESH_HOUR = 14;
const PUBLIC_API_HEADERS = { "Access-Control-Allow-Origin": "*" } as const;

export type PublicApiRequestHandler = (
  request: Request,
) => Promise<Response | undefined>;

type PublicApiDependencies = {
  fetch?: Fetcher;
  now?: () => Date;
};

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createPublicApiRequestHandler(
  dependencies: PublicApiDependencies = {},
): PublicApiRequestHandler {
  const fetchUpstream = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());

  return async (request) => {
    const url = new URL(request.url);
    if (
      url.pathname !== "/api/pub/securities" &&
      url.pathname !== "/api/pub/prices"
    ) {
      return undefined;
    }

    if (request.method !== "GET") {
      return Response.json(
        { status: "method_not_allowed" },
        {
          status: 405,
          headers: { ...PUBLIC_API_HEADERS, Allow: "GET" },
        },
      );
    }

    if (url.pathname === "/api/pub/securities") {
      return fetchPublicResource(
        request,
        SECURITIES_URL,
        SECURITIES_REFRESH_HOUR,
        fetchUpstream,
        now,
      );
    }

    const market = url.searchParams.get("market");
    if (!isPriceMarket(market)) {
      return invalidMarketResponse();
    }

    return fetchPublicResource(
      request,
      PRICE_URLS[market],
      PRICES_REFRESH_HOUR,
      fetchUpstream,
      now,
    );
  };
}

export function secondsUntilNextSecuritiesRefresh(now: Date): number {
  return secondsUntilNextRefresh(now, SECURITIES_REFRESH_HOUR);
}

export function secondsUntilNextPricesRefresh(now: Date): number {
  return secondsUntilNextRefresh(now, PRICES_REFRESH_HOUR);
}

function secondsUntilNextRefresh(now: Date, refreshHour: number): number {
  const taipeiTimestamp = now.getTime() + TAIPEI_UTC_OFFSET_MS;
  const taipeiNow = new Date(taipeiTimestamp);
  let nextRefreshTimestamp = Date.UTC(
    taipeiNow.getUTCFullYear(),
    taipeiNow.getUTCMonth(),
    taipeiNow.getUTCDate(),
    refreshHour,
  );

  if (nextRefreshTimestamp <= taipeiTimestamp) {
    nextRefreshTimestamp += 24 * 60 * 60 * 1000;
  }

  return Math.ceil((nextRefreshTimestamp - taipeiTimestamp) / 1000);
}

async function fetchPublicResource(
  request: Request,
  upstreamUrl: string,
  refreshHour: number,
  fetchUpstream: Fetcher,
  now: () => Date,
): Promise<Response> {
  try {
    const upstreamResponse = await fetchUpstream(upstreamUrl, {
      headers: { Accept: "application/json" },
      signal: request.signal,
    });

    if (!upstreamResponse.ok) {
      return upstreamErrorResponse();
    }

    const maxAge = secondsUntilNextRefresh(now(), refreshHour);
    return new Response(upstreamResponse.body, {
      status: 200,
      headers: {
        ...PUBLIC_API_HEADERS,
        "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch {
    return upstreamErrorResponse();
  }
}

function isPriceMarket(
  market: string | null,
): market is keyof typeof PRICE_URLS {
  return market === "TSE" || market === "OTC";
}

function invalidMarketResponse(): Response {
  return Response.json(
    { status: "invalid_request", message: "market must be TSE or OTC" },
    {
      status: 400,
      headers: { ...PUBLIC_API_HEADERS, "Cache-Control": "no-store" },
    },
  );
}

function upstreamErrorResponse(): Response {
  return Response.json(
    { status: "upstream_unavailable" },
    {
      status: 502,
      headers: { ...PUBLIC_API_HEADERS, "Cache-Control": "no-store" },
    },
  );
}
