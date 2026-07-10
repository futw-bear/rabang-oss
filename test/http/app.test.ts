import { describe, expect, test } from "bun:test";
import type {
  Connector,
  ConnectorStatus,
} from "../../src/connectors/connector.ts";
import { createRequestHandler } from "../../src/http/app.ts";

describe("GET /", () => {
  test("returns 503 while the connector is attempting to connect", async () => {
    const handler = createRequestHandler(new StubConnector("attempting"));
    const response = handler(new Request("http://localhost/"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "attempting" });
  });

  test("returns 200 after the connector connects", async () => {
    const handler = createRequestHandler(new StubConnector("connected"));
    const response = handler(new Request("http://localhost/"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

class StubConnector implements Connector {
  constructor(readonly status: ConnectorStatus) {}

  async connect(): Promise<void> {}

  onDisconnect(): () => void {
    return () => {};
  }
}
