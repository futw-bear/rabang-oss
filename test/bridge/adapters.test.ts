import { describe, expect, test } from "bun:test";
import {
  BRIDGE_ENDPOINT_METHODS,
  createBridgeRequestHandler,
} from "../../src/bridge/bridge.ts";
import { SqliteOrderStore } from "../../src/bridge/order-store.ts";
import type { FubonProxyInvocation } from "../../src/proxy/fubon-proxy-types.ts";

describe("bridge endpoint inventory", () => {
  test("registers the complete documented Shioaji HTTP and SSE inventory", () => {
    expect(BRIDGE_ENDPOINT_METHODS.size).toBe(56);
    expect(BRIDGE_ENDPOINT_METHODS.get("/api/v1/order/place_order")).toBe(
      "POST",
    );
    expect(BRIDGE_ENDPOINT_METHODS.get("/api/v1/stream/data/tick_stk")).toBe(
      "GET",
    );
    expect(BRIDGE_ENDPOINT_METHODS.get("/api/v1/apps")).toBe("GET");
  });

  test("publishes bridge paths in OpenAPI", async () => {
    const handler = createBridgeRequestHandler(
      new FlexibleConnector(() => ({})),
    );
    const response = await handler(
      new Request("http://localhost/bridge/openapi.json"),
    );
    const body = (await response?.json()) as { paths: Record<string, unknown> };

    expect(response?.status).toBe(200);
    expect(
      body.paths["/bridge/api/v1/portfolio/account_balance"],
    ).toBeDefined();
    expect(body.paths["/bridge/api/v1/order/place_order"]).toBeDefined();
  });

  test("returns 501 for every explicitly unsupported capability", async () => {
    const handler = createBridgeRequestHandler(
      new FlexibleConnector(() => ({})),
    );
    const endpoints: Array<[string, string]> = [
      ["GET", "/auth/usage"],
      ["GET", "/auth/ca_expiretime?person_id=A123456789"],
      ["POST", "/data/daily_quotes"],
      ["GET", "/data/regulatory_punish"],
      ["GET", "/data/regulatory_notice"],
      ["POST", "/order/place_comboorder"],
      ["POST", "/order/cancel_comboorder"],
      ["POST", "/order/combotrades"],
      ["POST", "/order/stock_reserve_summary"],
      ["POST", "/order/stock_reserve_detail"],
      ["POST", "/order/reserve_stock"],
      ["POST", "/order/earmarking_detail"],
      ["POST", "/order/reserve_earmarking"],
      ["POST", "/portfolio/position_detail"],
      ["POST", "/portfolio/trading_limits"],
      ["POST", "/portfolio/profit_loss_detail"],
    ];

    for (const [method, path] of endpoints) {
      const response = await handler(
        new Request(`http://localhost/bridge/api/v1${path}`, {
          method,
          body: method === "POST" ? "{}" : undefined,
        }),
      );
      expect(response?.status, `${method} ${path}`).toBe(501);
    }
  });
});

describe("portfolio adapters", () => {
  test("maps Fubon futures equity to the Shioaji margin schema", async () => {
    const connector = new FlexibleConnector(() => ({
      isSuccess: true,
      data: [
        {
          currency: "TWD",
          yesterdayBalance: 100,
          todayBalance: 120,
          todayDeposit: 30,
          todayWithdrawal: 10,
          initialMargin: 40,
          maintenanceMargin: 20,
          todayEquity: 150,
          availableMargin: 80,
          futUnrealizedPnl: 5,
        },
      ],
    }));
    const response = await post(connector, "/portfolio/margin", {
      account_type: "F",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      yesterday_balance: 100,
      today_balance: 120,
      deposit_withdrawal: 20,
      initial_margin: 40,
      maintenance_margin: 20,
      equity: 150,
      available_margin: 80,
      future_open_position: 5,
    });
    expect(connector.invocations[0]?.target).toEqual({
      service: "futoptAccounting",
      methodPath: ["queryMarginEquity"],
    });
  });

  test("maps Fubon unrealized stock P&L to Shioaji positions", async () => {
    const connector = new FlexibleConnector((invocation) =>
      invocation.target.methodPath[0] === "inventories"
        ? {
            isSuccess: true,
            data: [
              {
                stockNo: "2330",
                orderType: "Stock",
                todayQty: 2000,
                lastdayQty: 1000,
                odd: { todayQty: 0, lastdayQty: 0 },
              },
            ],
          }
        : {
            isSuccess: true,
            data: [
              {
                stockNo: "2330",
                buySell: "Buy",
                orderType: "Stock",
                costPrice: 600,
                todayQty: 2000,
                tradableQty: 1000,
                unrealizedProfit: 2000,
                unrealizedLoss: 0,
              },
            ],
          },
    );
    const response = await post(connector, "/portfolio/position_unit", {
      unit: "Common",
    });

    expect(await response.json()).toEqual([
      {
        id: 0,
        code: "2330",
        direction: "Buy",
        quantity: 2,
        price: 600,
        last_price: 601,
        pnl: 2000,
        yd_quantity: 1,
        cond: "Cash",
        margin_purchase_amount: 0,
        collateral: 0,
        short_sale_margin: 0,
        interest: 0,
      },
    ]);
  });

  test("maps Fubon settlement rows to current Shioaji settlement rows", async () => {
    const connector = new FlexibleConnector(() => ({
      isSuccess: true,
      data: {
        details: [
          { settlementDate: "2026/07/13", totalSettlementAmount: 100 },
          { settlementDate: "2026/07/14", totalSettlementAmount: -200 },
        ],
      },
    }));
    const response = await post(connector, "/portfolio/settlements", {});

    expect(await response.json()).toEqual([
      { date: "2026-07-13", amount: 100, T: 0 },
      { date: "2026-07-14", amount: -200, T: 1 },
    ]);
  });
});

describe("market-data adapters", () => {
  test("maps an intraday Fubon quote to a Shioaji snapshot", async () => {
    const connector = new FlexibleConnector(() => ({
      symbol: "2330",
      exchange: "TWSE",
      openPrice: 100,
      highPrice: 110,
      lowPrice: 99,
      closePrice: 108,
      change: 8,
      changePercent: 8,
      avgPrice: 105,
      lastSize: 2,
      lastUpdated: 1685338200000000,
      bids: [{ price: 107, size: 5 }],
      asks: [{ price: 108, size: 6 }],
      total: { tradeVolume: 1000, tradeValue: 105000 },
    }));
    const response = await post(connector, "/data/snapshots", {
      contracts: [{ security_type: "STK", exchange: "TSE", code: "2330" }],
    });
    const values = (await response.json()) as Record<string, unknown>[];

    expect(values[0]).toMatchObject({
      datetime: "2023-05-29T13:30:00.000000",
      code: "2330",
      exchange: "TSE",
      close: 108,
      total_volume: 1000,
      buy_price: 107,
      sell_price: 108,
    });
  });

  test("maps Fubon candles to Shioaji column arrays", async () => {
    const connector = new FlexibleConnector(() => ({
      data: [
        {
          date: "2026-07-13",
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 10,
        },
      ],
    }));
    const response = await post(connector, "/data/kbars", {
      contract: { security_type: "STK", exchange: "TSE", code: "2330" },
      start: "2026-07-13",
      end: "2026-07-13",
    });

    expect(await response.json()).toEqual({
      datetime: ["2026-07-13T00:00:00"],
      Open: [1],
      High: [2],
      Low: [0.5],
      Close: [1.5],
      Volume: [10],
      Amount: [0],
    });
  });

  test("maps Fubon margin quota to Shioaji credit enquiry", async () => {
    const connector = new FlexibleConnector(() => ({
      isSuccess: true,
      data: [
        {
          stockNo: "2330",
          marginTradableQuota: 776,
          shortsellTradableQuota: 12,
          marginRatio: 60,
          shortRatio: 90,
        },
      ],
    }));
    const response = await post(connector, "/data/credit_enquire", {
      contracts: [{ security_type: "STK", exchange: "TSE", code: "2330" }],
    });

    expect(await response.json()).toEqual([
      {
        update_time: expect.any(String),
        system: "ALL",
        stock_id: "2330",
        margin_unit: 776,
        short_unit: 12,
        margin_loan_ratio: 60,
        short_margin_ratio: 90,
      },
    ]);
  });
});

describe("order adapters", () => {
  test("converts a Shioaji stock order to Fubon units and returns a nested Trade", async () => {
    const connector = new FlexibleConnector(() => ({
      isSuccess: true,
      data: {
        seqNo: "00001",
        orderNo: "A001",
        buySell: "Buy",
        price: 600,
        quantity: 2000,
        unit: 1000,
        afterQty: 2000,
        filledQty: 0,
        status: 10,
      },
    }));
    const response = await post(connector, "/order/place_order", {
      contract: { security_type: "STK", exchange: "TSE", code: "2330" },
      stock_order: {
        action: "Buy",
        price: 600,
        quantity: 2,
        price_type: "LMT",
        order_type: "ROD",
        order_lot: "Common",
      },
    });
    const trade = (await response.json()) as Record<
      string,
      Record<string, unknown>
    >;

    expect(response.status).toBe(200);
    expect(connector.invocations[0]?.arguments[1]).toMatchObject({
      symbol: "2330",
      price: "600",
      quantity: 2000,
      priceType: "Limit",
      marketType: "Common",
    });
    expect(trade.order?.id).toBe("00001");
    expect(trade.status?.status).toBe("Submitted");
  });

  test("updates and cancels a persisted stock order", async () => {
    const databasePath = `${process.env.TMPDIR ?? "/tmp"}/rabang-orders-${crypto.randomUUID()}.sqlite`;
    const original = {
      seqNo: "00002",
      orderNo: "A002",
      buySell: "Buy",
      price: 600,
      afterPrice: 600,
      quantity: 2000,
      unit: 1000,
      afterQty: 2000,
      filledQty: 0,
      status: 10,
    };
    const connector = new FlexibleConnector((invocation) => {
      const method = invocation.target.methodPath[0];
      if (method === "placeOrder") return { isSuccess: true, data: original };
      if (method?.startsWith("makeModify")) {
        return { generatedBy: method, args: invocation.arguments };
      }
      if (method === "modifyPrice") {
        return {
          isSuccess: true,
          data: { ...original, afterPrice: 590, functionType: 15 },
        };
      }
      if (method === "modifyQuantity") {
        return {
          isSuccess: true,
          data: {
            ...original,
            afterPrice: 590,
            afterQty: 1000,
            functionType: 20,
          },
        };
      }
      if (method === "cancelOrder") {
        return {
          isSuccess: true,
          data: { ...original, afterPrice: 590, afterQty: 0, status: 30 },
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    let store = new SqliteOrderStore(databasePath);
    let handler = createBridgeRequestHandler(connector, undefined, store);
    await handler(
      jsonRequest("/order/place_order", "POST", {
        contract: { security_type: "STK", exchange: "TSE", code: "2330" },
        stock_order: {
          action: "Buy",
          price: 600,
          quantity: 2,
          price_type: "LMT",
          order_type: "ROD",
          order_lot: "Common",
        },
      }),
    );
    store.close();

    store = new SqliteOrderStore(databasePath);
    handler = createBridgeRequestHandler(connector, undefined, store);
    const priceResponse = await handler(
      jsonRequest("/order/update_price", "POST", {
        trade_id: "00002",
        price: 590,
      }),
    );
    const quantityResponse = await handler(
      jsonRequest("/order/update_qty", "POST", {
        trade_id: "00002",
        quantity: 1,
      }),
    );
    const cancelResponse = await handler(
      jsonRequest("/order/cancel_order", "POST", { trade_id: "00002" }),
    );
    store.close();
    await Bun.file(databasePath).delete();

    expect(priceResponse?.status).toBe(200);
    expect(await priceResponse?.json()).toMatchObject({
      order: { price: 590, quantity: 2 },
    });
    expect(await quantityResponse?.json()).toMatchObject({
      order: { quantity: 1 },
      status: { order_quantity: 1, cancel_quantity: 1 },
    });
    expect(await cancelResponse?.json()).toMatchObject({
      order: { quantity: 2 },
      status: { status: "Cancelled", order_quantity: 0, cancel_quantity: 2 },
    });
    expect(
      connector.invocations.map((item) => item.target.methodPath[0]),
    ).toEqual([
      "placeOrder",
      "makeModifyPriceObj",
      "modifyPrice",
      "makeModifyQuantityObj",
      "modifyQuantity",
      "cancelOrder",
    ]);
    expect(connector.invocations[3]?.arguments[1]).toBe(1000);
  });

  test("uses futures lot modification methods", async () => {
    const connector = new FlexibleConnector((invocation) => {
      const method = invocation.target.methodPath[0];
      if (method === "placeOrder") {
        return {
          isSuccess: true,
          data: {
            seqNo: "F0001",
            orderNo: "F001",
            assetType: 1,
            symbol: "TXF",
            buySell: "Buy",
            price: 20000,
            lot: 2,
            afterLot: 2,
            filledLot: 0,
            status: 10,
          },
        };
      }
      if (method === "makeModifyLotObj") return { lot: 1 };
      if (method === "modifyLot") {
        return {
          isSuccess: true,
          data: {
            seqNo: "F0001",
            orderNo: "F001",
            assetType: 1,
            symbol: "TXF",
            price: 20000,
            lot: 2,
            afterLot: 1,
            filledLot: 0,
            status: 10,
          },
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const handler = createBridgeRequestHandler(connector);
    await handler(
      jsonRequest("/order/place_order", "POST", {
        contract: { security_type: "FUT", exchange: "TAIFEX", code: "TXF" },
        futures_order: {
          action: "Buy",
          price: 20000,
          quantity: 2,
          price_type: "LMT",
          order_type: "ROD",
        },
      }),
    );
    expect(connector.invocations[0]?.arguments[1]).toMatchObject({
      symbol: "TXF",
      price: "20000",
      lot: 2,
      priceType: "Limit",
      marketType: "Future",
    });
    const response = await handler(
      jsonRequest("/order/update_qty", "POST", {
        trade_id: "F0001",
        quantity: 1,
      }),
    );

    expect(response?.status).toBe(200);
    expect(connector.invocations.slice(-2)).toMatchObject([
      {
        target: { service: "futopt", methodPath: ["makeModifyLotObj"] },
        arguments: [expect.any(Object), 1],
      },
      {
        target: { service: "futopt", methodPath: ["modifyLot"] },
      },
    ]);
  });
});

describe("local and streaming APIs", () => {
  test("supports a watchlist CRUD lifecycle", async () => {
    const connector = new FlexibleConnector(() => ({}));
    const handler = createBridgeRequestHandler(connector);
    const createdResponse = await handler(
      jsonRequest("/watchlist", "POST", {
        name: "Favorites",
        contracts: [{ security_type: "STK", exchange: "TSE", code: "2330" }],
      }),
    );
    const created = (await createdResponse?.json()) as { id: string };
    const fetched = await handler(
      new Request(`http://localhost/bridge/api/v1/watchlist/${created.id}`),
    );
    const deleted = await handler(
      new Request(`http://localhost/bridge/api/v1/watchlist/${created.id}`, {
        method: "DELETE",
      }),
    );

    expect(createdResponse?.status).toBe(200);
    expect(await fetched?.json()).toMatchObject({ name: "Favorites" });
    expect(await deleted?.json()).toMatchObject({ id: created.id });
  });

  test("uploads and serves app files from safe in-memory paths", async () => {
    const connector = new FlexibleConnector(() => ({}));
    const handler = createBridgeRequestHandler(connector);
    const form = new FormData();
    form.append(
      "files",
      new File(["<h1>Bridge</h1>"], "index.html", { type: "text/html" }),
    );
    const uploaded = await handler(
      new Request("http://localhost/bridge/api/v1/apps/dashboard", {
        method: "POST",
        headers: { "Content-Length": "100" },
        body: form,
      }),
    );
    const served = await handler(
      new Request("http://localhost/bridge/apps/dashboard/index.html"),
    );

    expect(await uploaded?.json()).toEqual({
      name: "dashboard",
      files: ["dashboard/index.html"],
    });
    expect(served?.headers.get("Content-Type")).toStartWith("text/html");
    expect(await served?.text()).toBe("<h1>Bridge</h1>");
  });

  test("translates stock subscriptions to a shared Fubon WebSocket", async () => {
    const connector = new FlexibleConnector(() => ({}));
    const handler = createBridgeRequestHandler(connector);
    const subscription = {
      security_type: "STK",
      exchange: "TSE",
      code: "2330",
      quote_type: "Tick",
      intraday_odd: false,
    };
    const response = await handler(
      jsonRequest("/stream/subscribe", "POST", subscription),
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      success: true,
      subscription,
    });
    expect(connector.openedSockets).toEqual(["shioaji-bridge-stream-stock"]);
    expect(JSON.parse(connector.socketMessages[0] ?? "{}")).toEqual({
      event: "subscribe",
      data: {
        channel: "trades",
        symbol: "2330",
        intradayOddLot: false,
      },
    });
  });

  test("converts Fubon fill callbacks to Shioaji order-event SSE", async () => {
    const connector = new FlexibleConnector(() => ({}));
    const handler = createBridgeRequestHandler(connector);
    await handler(jsonRequest("/auth/subscribe_trade", "POST", {}));
    const response = await handler(
      new Request("http://localhost/bridge/api/v1/stream/data/order_event"),
    );
    const reader = response?.body?.getReader();
    await reader?.read();

    connector.emitTradingEvent({
      kind: "filled",
      code: "00",
      content: {
        branchNo: "6460",
        account: "26",
        stockNo: "2330",
        buySell: "Buy",
        filledPrice: 600,
        filledQty: 1000,
        seqNo: "00001",
      },
    });
    const event = await reader?.read();
    await reader?.cancel();
    const text = new TextDecoder().decode(event?.value);

    expect(text).toContain("event: order_event");
    expect(text).toContain('"state":"StockDeal"');
    expect(text).toContain('"code":"2330"');
  });
});

async function post(
  connector: FlexibleConnector,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await createBridgeRequestHandler(connector)(
    jsonRequest(path, "POST", body),
  );
  if (!response) throw new Error("Bridge did not claim request");
  return response;
}

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://localhost/bridge/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

class FlexibleConnector {
  readonly status = "connected" as const;
  readonly simulation = true;
  readonly invocations: FubonProxyInvocation[] = [];
  readonly openedSockets: string[] = [];
  readonly socketMessages: string[] = [];
  readonly accounts = [
    {
      name: "Stock",
      branchNo: "6460",
      account: "26",
      accountType: "stock",
    },
    {
      name: "Futures",
      branchNo: "15901",
      account: "1234567",
      accountType: "futopt",
    },
  ];
  private tradingListener:
    | ((event: {
        kind: "order" | "orderChanged" | "filled";
        code: string;
        content: unknown;
      }) => void)
    | undefined;

  constructor(
    private readonly resolve: (invocation: FubonProxyInvocation) => unknown,
  ) {}

  async connect(): Promise<void> {}

  async invokeProxy(invocation: FubonProxyInvocation): Promise<unknown> {
    this.invocations.push(invocation);
    return this.resolve(invocation);
  }

  onDisconnect(): () => void {
    return () => {};
  }

  async openMarketDataWebSocket(id: string): Promise<void> {
    this.openedSockets.push(id);
  }

  async sendMarketDataWebSocket(_id: string, message: string): Promise<void> {
    this.socketMessages.push(message);
  }

  async closeMarketDataWebSocket(): Promise<void> {}

  onMarketDataWebSocketMessage(): () => void {
    return () => {};
  }

  onTradingEvent(
    listener: (event: {
      kind: "order" | "orderChanged" | "filled";
      code: string;
      content: unknown;
    }) => void,
  ): () => void {
    this.tradingListener = listener;
    return () => {
      this.tradingListener = undefined;
    };
  }

  emitTradingEvent(event: {
    kind: "order" | "orderChanged" | "filled";
    code: string;
    content: unknown;
  }): void {
    this.tradingListener?.(event);
  }
}
