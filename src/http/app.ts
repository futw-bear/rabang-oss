import type { Connector } from "../connectors/connector.ts";

export function createRequestHandler(
  connector: Connector,
): (request: Request) => Response {
  return (request) => {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      if (connector.status === "connected") {
        return Response.json({ status: "ok" }, { status: 200 });
      }

      return Response.json({ status: "attempting" }, { status: 503 });
    }

    return Response.json({ status: "not_found" }, { status: 404 });
  };
}
