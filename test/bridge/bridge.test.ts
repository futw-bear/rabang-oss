import { describe, expect, test } from "bun:test";
import { createBridgeRequestHandler } from "../../src/bridge/bridge.ts";
import type { ConnectorStatus } from "../../src/connectors/connector.ts";
import type { FubonProxyInvocation } from "../../src/proxy/fubon-proxy-types.ts";

const queryTime = new Date("2026-07-13T01:05:30.873Z");

describe("Shioaji API bridge", () => {
  test("maps account_balance request and response through Fubon bankRemain", async () => {
    const connector = new StubConnector("connected", {
      isSuccess: true,
      data: { availableBalance: "123456" },
    });
    const handler = createBridgeRequestHandler(connector, () => queryTime);
    const response = await handler(
      new Request("http://localhost/bridge/api/v1/portfolio/account_balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_type: "S",
          broker_id: "6460",
          account_id: "26",
        }),
      }),
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      acc_balance: 123456,
      date: "2026-07-13 09:05:30.873000",
      errmsg: "",
    });
    expect(connector.invocations).toEqual([
      {
        target: { service: "accounting", methodPath: ["bankRemain"] },
        arguments: [connector.accounts[0]],
      },
    ]);
  });

  test("uses the first stock account when selectors are omitted", async () => {
    const connector = new StubConnector("connected", {
      isSuccess: true,
      data: { availableBalance: 1000 },
    });
    const handler = createBridgeRequestHandler(connector, () => queryTime);
    await handler(
      new Request("http://localhost/bridge/api/v1/portfolio/account_balance", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(connector.invocations[0]?.arguments).toEqual([
      connector.accounts[0],
    ]);
  });

  test("returns Shioaji-shaped validation errors", async () => {
    const connector = new StubConnector("connected", {});
    const handler = createBridgeRequestHandler(connector);
    const response = await handler(
      new Request("http://localhost/bridge/api/v1/portfolio/account_balance", {
        method: "POST",
        body: JSON.stringify({ account_type: "F" }),
      }),
    );

    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({
      code: 400,
      message: 'account_type must be "S"',
      details: null,
    });
    expect(connector.invocations).toEqual([]);
  });

  test("does not silently ignore a person_id selector", async () => {
    const connector = new StubConnector("connected", {});
    const handler = createBridgeRequestHandler(connector);
    const response = await handler(
      new Request("http://localhost/bridge/api/v1/portfolio/account_balance", {
        method: "POST",
        body: JSON.stringify({ person_id: "A123456789" }),
      }),
    );

    expect(response?.status).toBe(501);
    expect(await response?.json()).toEqual({
      code: 501,
      message:
        "person_id account selection is unavailable from Fubon login data",
      details: null,
    });
    expect(connector.invocations).toEqual([]);
  });

  test("returns not found when an order mutation has no persisted trade", async () => {
    const handler = createBridgeRequestHandler(
      new StubConnector("connected", {}),
    );
    const response = await handler(
      new Request("http://localhost/bridge/api/v1/order/cancel_order", {
        method: "POST",
        body: JSON.stringify({ trade_id: "missing" }),
      }),
    );

    expect(response?.status).toBe(404);
    expect(await response?.json()).toEqual({
      code: 404,
      message: "Trade not found: missing",
      details: null,
    });
  });

  test("does not claim requests outside the bridge prefix", async () => {
    const handler = createBridgeRequestHandler(
      new StubConnector("connected", {}),
    );

    expect(await handler(new Request("http://localhost/proxy/example"))).toBe(
      undefined,
    );
  });
});

class StubConnector {
  readonly invocations: FubonProxyInvocation[] = [];
  readonly accounts = [
    {
      name: "Stock Account",
      branchNo: "6460",
      account: "26",
      accountType: "stock",
    },
    {
      name: "Futures Account",
      branchNo: "15901",
      account: "1234567",
      accountType: "futopt",
    },
  ];

  constructor(
    readonly status: ConnectorStatus,
    private readonly result: unknown,
  ) {}

  async connect(): Promise<void> {}

  async invokeProxy(invocation: FubonProxyInvocation): Promise<unknown> {
    this.invocations.push(invocation);
    return this.result;
  }

  onDisconnect(): () => void {
    return () => {};
  }
}
