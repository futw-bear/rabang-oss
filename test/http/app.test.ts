import { describe, expect, test } from "bun:test";
import type {
  Connector,
  ConnectorStatus,
} from "../../src/connectors/connector.ts";
import { createRequestHandler } from "../../src/http/app.ts";
import type { FubonProxyInvocation } from "../../src/proxy/fubon-proxy-types.ts";

describe("GET /", () => {
  test("returns 503 while the connector is attempting to connect", async () => {
    const handler = createRequestHandler(new StubConnector("attempting"));
    const response = await handler(new Request("http://localhost/"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "attempting" });
  });

  test("returns 200 after the connector connects", async () => {
    const handler = createRequestHandler(new StubConnector("connected"));
    const response = await handler(new Request("http://localhost/"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("Fubon proxy API", () => {
  test("forwards market data query parameters without renaming keys", async () => {
    const connector = new StubConnector("connected", {
      date: "2026-07-11",
      nameEn: "Example",
    });
    const handler = createRequestHandler(connector);
    const response = await handler(
      new Request(
        "http://localhost/proxy/market-data/intraday/ticker?symbol=2330&type=oddlot",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      date: "2026-07-11",
      nameEn: "Example",
    });
    expect(connector.invocations).toEqual([
      {
        target: {
          service: "marketDataStock",
          methodPath: ["intraday", "ticker"],
        },
        arguments: [{ symbol: "2330", type: "oddlot" }],
      },
    ]);
  });

  test("forwards a documented market data path parameter without renaming it", async () => {
    const connector = new StubConnector("connected", { symbol: "2330" });
    const handler = createRequestHandler(connector);
    const response = await handler(
      new Request(
        "http://localhost/proxy/market-data/intraday/ticker/2330?type=oddlot",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ symbol: "2330" });
    expect(connector.invocations[0]?.arguments).toEqual([
      { symbol: "2330", type: "oddlot" },
    ]);
  });

  test("rejects conflicting path and query parameter values", async () => {
    const connector = new StubConnector("connected");
    const handler = createRequestHandler(connector);
    const response = await handler(
      new Request(
        "http://localhost/proxy/market-data/intraday/ticker/2330?symbol=2317",
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "invalid_request",
      message: "Path parameter symbol conflicts with the query parameter",
    });
  });

  test("forwards a trading mutation as ordered SDK arguments", async () => {
    const connector = new StubConnector("connected", { isSuccess: true });
    const handler = createRequestHandler(connector);
    const account = { branchNo: "1234", account: "567890" };
    const order = { symbol: "2330", quantity: 1000 };
    const response = await handler(
      new Request("http://localhost/proxy/trading/trade/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, order, unblock: false }),
      }),
    );

    expect(response.status).toBe(200);
    expect(connector.invocations).toEqual([
      {
        target: { service: "stock", methodPath: ["placeOrder"] },
        arguments: [account, order, false],
      },
    ]);
  });

  test("uses the first authenticated account when account is omitted", async () => {
    const accounts = [
      { name: "First", branchNo: "1000", account: "000001", accountType: "stock" },
      { name: "Second", branchNo: "2000", account: "000002", accountType: "stock" },
    ];
    const connector = new StubConnector("connected", {}, accounts);
    const handler = createRequestHandler(connector);
    const response = await handler(
      new Request("http://localhost/proxy/trading/account-management/inventories"),
    );

    expect(response.status).toBe(200);
    expect(connector.invocations[0]?.arguments).toEqual([accounts[0]]);
  });

  test("selects an authenticated account by its query index", async () => {
    const accounts = [
      { name: "First", branchNo: "1000", account: "000001", accountType: "stock" },
      { name: "Second", branchNo: "2000", account: "000002", accountType: "stock" },
    ];
    const connector = new StubConnector("connected", {}, accounts);
    const handler = createRequestHandler(connector);
    const response = await handler(
      new Request(
        "http://localhost/proxy/trading/account-management/inventories?account=1",
      ),
    );

    expect(response.status).toBe(200);
    expect(connector.invocations[0]?.arguments).toEqual([accounts[1]]);
  });

  test("accepts an account index in the query for POST endpoints", async () => {
    const accounts = [
      { name: "First", branchNo: "1000", account: "000001", accountType: "stock" },
      { name: "Second", branchNo: "2000", account: "000002", accountType: "stock" },
    ];
    const connector = new StubConnector("connected", {}, accounts);
    const handler = createRequestHandler(connector);
    const order = { symbol: "2330", quantity: 1000 };
    const response = await handler(
      new Request("http://localhost/proxy/trading/trade/place-order?account=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      }),
    );

    expect(response.status).toBe(200);
    expect(connector.invocations[0]?.arguments).toEqual([accounts[1], order]);
  });

  test("rejects unavailable authenticated account indexes", async () => {
    const connector = new StubConnector("connected", {}, [
      { name: "First", branchNo: "1000", account: "000001", accountType: "stock" },
    ]);
    const handler = createRequestHandler(connector);
    const response = await handler(
      new Request(
        "http://localhost/proxy/trading/account-management/inventories?account=1",
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "invalid_request",
      message: "Authenticated account index is unavailable: 1",
    });
  });

  test("decodes object and array GET parameters from JSON", async () => {
    const connector = new StubConnector("connected", { isSuccess: true });
    const handler = createRequestHandler(connector);
    const account = encodeURIComponent(
      JSON.stringify({ branchNo: "1234", account: "567890" }),
    );
    const stockTypes = encodeURIComponent(JSON.stringify(["Stock", "ETF"]));
    const response = await handler(
      new Request(
        `http://localhost/proxy/trading/trade/query-symbol-snapshot?account=${account}&stockTypes=${stockTypes}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(connector.invocations[0]?.arguments).toEqual([
      { branchNo: "1234", account: "567890" },
      undefined,
      ["Stock", "ETF"],
    ]);
  });

  test("uses POST only for resource-changing operations", async () => {
    const connector = new StubConnector("connected");
    const handler = createRequestHandler(connector);
    const response = await handler(
      new Request("http://localhost/proxy/trading/trade/place-order"),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(connector.invocations).toEqual([]);
  });

  test("rejects a request with missing required parameters", async () => {
    const connector = new StubConnector("connected");
    const handler = createRequestHandler(connector);
    const response = await handler(
      new Request("http://localhost/proxy/trading/trade/order-history"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "invalid_request",
      message: "Missing required parameter: startDate",
    });
  });

  test("does not invoke the gateway before the connector is ready", async () => {
    const connector = new StubConnector("attempting");
    const handler = createRequestHandler(connector);
    const response = await handler(
      new Request("http://localhost/proxy/market-data/intraday/ticker?symbol=2330"),
    );

    expect(response.status).toBe(503);
    expect(connector.invocations).toEqual([]);
  });
});

class StubConnector implements Connector {
  readonly invocations: FubonProxyInvocation[] = [];
  readonly accounts;

  constructor(
    readonly status: ConnectorStatus,
    private readonly proxyResult: unknown = {},
    accounts = [
      {
        name: "Test Account",
        branchNo: "1234",
        account: "567890",
        accountType: "stock",
      },
    ],
  ) {
    this.accounts = accounts;
  }

  async connect(): Promise<void> {}

  async invokeProxy(invocation: FubonProxyInvocation): Promise<unknown> {
    this.invocations.push(invocation);
    return this.proxyResult;
  }

  onDisconnect(): () => void {
    return () => {};
  }
}
