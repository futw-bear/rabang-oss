import type { Connector } from "../connectors/connector.ts";
import { createRequestHandler } from "./app.ts";

export function startHttpServer(
  connector: Connector,
  port: number,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    fetch: createRequestHandler(connector),
  });
}
