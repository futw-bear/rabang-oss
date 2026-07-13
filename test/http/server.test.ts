import { describe, expect, test } from "bun:test";
import { isBridgeSseRequest } from "../../src/http/server.ts";

describe("isBridgeSseRequest", () => {
  test("matches bridge SSE data endpoints", () => {
    expect(
      isBridgeSseRequest(
        new Request("http://localhost/bridge/api/v1/stream/data"),
      ),
    ).toBe(true);
    expect(
      isBridgeSseRequest(
        new Request("http://localhost/bridge/api/v1/stream/data/order_event"),
      ),
    ).toBe(true);
  });

  test("does not match non-SSE bridge requests", () => {
    expect(
      isBridgeSseRequest(
        new Request("http://localhost/bridge/api/v1/stream/status"),
      ),
    ).toBe(false);
    expect(
      isBridgeSseRequest(
        new Request("http://localhost/bridge/api/v1/stream/data", {
          method: "POST",
        }),
      ),
    ).toBe(false);
  });
});
