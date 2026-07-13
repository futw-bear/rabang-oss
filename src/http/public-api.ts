const SECURITIES_URL =
  "https://raw.githubusercontent.com/futw-bear/securities-list/refs/heads/main/data/parsed/securities.json";
const TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const SECURITIES_REFRESH_HOUR = 6;
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
    if (url.pathname !== "/api/pub/securities") {
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

    try {
      const upstreamResponse = await fetchUpstream(SECURITIES_URL, {
        headers: { Accept: "application/json" },
        signal: request.signal,
      });

      if (!upstreamResponse.ok) {
        return upstreamErrorResponse();
      }

      const maxAge = secondsUntilNextSecuritiesRefresh(now());
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
  };
}

export function secondsUntilNextSecuritiesRefresh(now: Date): number {
  const taipeiTimestamp = now.getTime() + TAIPEI_UTC_OFFSET_MS;
  const taipeiNow = new Date(taipeiTimestamp);
  let nextRefreshTimestamp = Date.UTC(
    taipeiNow.getUTCFullYear(),
    taipeiNow.getUTCMonth(),
    taipeiNow.getUTCDate(),
    SECURITIES_REFRESH_HOUR,
  );

  if (nextRefreshTimestamp <= taipeiTimestamp) {
    nextRefreshTimestamp += 24 * 60 * 60 * 1000;
  }

  return Math.ceil((nextRefreshTimestamp - taipeiTimestamp) / 1000);
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
