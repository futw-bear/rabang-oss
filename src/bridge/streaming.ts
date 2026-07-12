import {
  asNumber,
  asString,
  assertAllowedFields,
  BridgeHttpError,
  type BridgeConnector,
  formatTimestamp,
  readJsonObject,
  record,
  selectAccount,
  stringField,
  unsupported,
} from "./common.ts";

interface StreamingConnector extends BridgeConnector {
  openMarketDataWebSocket?(
    id: string,
    mode: "speed" | "normal",
    product?: "stock" | "futopt",
  ): Promise<void>;
  sendMarketDataWebSocket?(id: string, message: string): Promise<void>;
  closeMarketDataWebSocket?(id: string): Promise<void>;
  onMarketDataWebSocketMessage?(
    listener: (message: { id: string; message: string }) => void,
  ): () => void;
  onTradingEvent?(
    listener: (event: {
      kind: "order" | "orderChanged" | "filled";
      code: string;
      content: unknown;
    }) => void,
  ): () => void;
}

interface Subscription {
  security_type: string;
  exchange: string;
  code: string;
  target_code?: string | null;
  quote_type: string;
  intraday_odd: boolean;
}

interface SseClient {
  event: string | undefined;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

export class BridgeStreaming {
  readonly #subscriptions = new Map<string, Subscription>();
  readonly #upstreamIds = new Map<string, string>();
  readonly #clients = new Set<SseClient>();
  readonly #tradeSubscriptions = new Set<string>();
  readonly #opened = new Set<"stock" | "futopt">();
  readonly #opening = new Map<"stock" | "futopt", Promise<void>>();
  #removeListener: (() => void) | undefined;

  constructor(
    private readonly connector: StreamingConnector,
    private readonly now: () => Date,
  ) {
    connector.onTradingEvent?.((event) => this.onTradingEvent(event));
    connector.onDisconnect(() => {
      this.#opened.clear();
      this.#opening.clear();
      this.#upstreamIds.clear();
    });
  }

  async tradeSubscription(
    subscribe: boolean,
    body: Record<string, unknown>,
  ): Promise<Response> {
    assertAllowedFields(body, [
      "account_type",
      "broker_id",
      "account_id",
      "person_id",
    ]);
    const account = selectAccount(
      this.connector.accounts,
      body,
      body.account_type === "F" ? "F" : "S",
    );
    const key = `${account.branchNo}:${account.account}`;
    if (subscribe) this.#tradeSubscriptions.add(key);
    else this.#tradeSubscriptions.delete(key);
    return Response.json({
      account: {
        account_type: account.accountType === "futopt" ? "F" : "S",
        broker_id: account.branchNo,
        account_id: account.account,
      },
      subscribe_trade: subscribe,
      ts: Math.floor(this.now().getTime() / 1000),
    });
  }

  async handle(path: string, request: Request): Promise<Response> {
    if (path === "/api/v1/stream/subscribe")
      return this.subscribe(await readJsonObject(request));
    if (path === "/api/v1/stream/unsubscribe")
      return this.unsubscribe(await readJsonObject(request));
    if (path === "/api/v1/stream/status") {
      return Response.json({
        active_connections: this.#clients.size,
        timestamp: this.now().toISOString(),
        status:
          this.connector.status === "connected" ? "connected" : "disconnected",
      });
    }
    if (path === "/api/v1/stream/receivers") {
      return new Response(
        [
          "tick_stk",
          "bidask_stk",
          "quote_stk",
          "tick_fop",
          "bidask_fop",
          "quote_fop",
          "order_event",
        ].join("\n"),
        { headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }
    if (path.startsWith("/api/v1/stream/data")) return this.sse(path, request);
    unsupported(path);
  }

  private async subscribe(body: Record<string, unknown>): Promise<Response> {
    const subscription = parseSubscription(body);
    const product = subscription.security_type === "STK" ? "stock" : "futopt";
    await this.ensureOpen(product);
    const key = subscriptionKey(subscription);
    this.#subscriptions.set(key, subscription);
    await this.connector.sendMarketDataWebSocket!(
      socketId(product),
      JSON.stringify({
        event: "subscribe",
        data: {
          channel: channelFor(subscription),
          symbol: subscription.target_code || subscription.code,
          ...(subscription.security_type === "STK"
            ? { intradayOddLot: subscription.intraday_odd }
            : {}),
        },
      }),
    );
    return Response.json({
      success: true,
      message: "Subscription accepted",
      subscription,
    });
  }

  private async unsubscribe(body: Record<string, unknown>): Promise<Response> {
    const subscription = parseSubscription(body);
    const product = subscription.security_type === "STK" ? "stock" : "futopt";
    const key = subscriptionKey(subscription);
    const upstreamId = this.#upstreamIds.get(key);
    if (!this.#subscriptions.has(key)) {
      return Response.json({
        success: false,
        message: "Subscription not found",
        subscription,
      });
    }
    if (!upstreamId) {
      throw new BridgeHttpError(
        409,
        "Fubon subscription acknowledgement has not arrived yet",
      );
    }
    await this.connector.sendMarketDataWebSocket!(
      socketId(product),
      JSON.stringify({ event: "unsubscribe", data: { id: upstreamId } }),
    );
    this.#subscriptions.delete(key);
    this.#upstreamIds.delete(key);
    return Response.json({
      success: true,
      message: "Unsubscription accepted",
      subscription,
    });
  }

  private sse(path: string, request: Request): Response {
    const event =
      path === "/api/v1/stream/data" ? undefined : path.split("/").at(-1);
    const supported = [
      undefined,
      "tick_stk",
      "bidask_stk",
      "quote_stk",
      "tick_fop",
      "bidask_fop",
      "quote_fop",
      "order_event",
    ];
    if (!supported.includes(event)) {
      unsupported(
        path,
        "The current gateway does not expose this Shioaji stream type",
      );
    }
    const encoder = new TextEncoder();
    let client: SseClient;
    let timer: ReturnType<typeof setInterval>;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        client = { event, controller };
        this.#clients.add(client);
        controller.enqueue(
          encoder.encode(
            formatSse("heartbeat", {
              type: "heartbeat",
              timestamp: this.now().toISOString(),
              connection_id: crypto.randomUUID(),
            }),
          ),
        );
        timer = setInterval(() => {
          try {
            controller.enqueue(
              encoder.encode(
                formatSse("heartbeat", {
                  type: "heartbeat",
                  timestamp: this.now().toISOString(),
                }),
              ),
            );
          } catch {
            clearInterval(timer);
          }
        }, 30_000);
      },
      cancel: () => {
        clearInterval(timer);
        this.#clients.delete(client);
      },
    });
    request.signal.addEventListener(
      "abort",
      () => {
        clearInterval(timer);
        this.#clients.delete(client);
        try {
          client.controller.close();
        } catch {}
      },
      { once: true },
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  private async ensureOpen(product: "stock" | "futopt"): Promise<void> {
    if (this.#opened.has(product)) return;
    const opening = this.#opening.get(product);
    if (opening) return opening;
    if (
      !this.connector.openMarketDataWebSocket ||
      !this.connector.sendMarketDataWebSocket ||
      !this.connector.onMarketDataWebSocketMessage
    ) {
      throw new BridgeHttpError(
        501,
        "Connector does not support market-data streaming",
      );
    }
    const promise = this.connector
      .openMarketDataWebSocket(socketId(product), "speed", product)
      .then(() => {
        this.#opened.add(product);
        if (!this.#removeListener) {
          this.#removeListener = this.connector.onMarketDataWebSocketMessage!(
            (message) => {
              const messageProduct = productForSocket(message.id);
              if (messageProduct)
                this.onMessage(message.message, messageProduct);
            },
          );
        }
      })
      .finally(() => {
        this.#opening.delete(product);
      });
    this.#opening.set(product, promise);
    return promise;
  }

  private onMessage(raw: string, product: "stock" | "futopt"): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const envelope = record(message);
    const event = asString(envelope.event);
    const data =
      typeof envelope.data === "object" && envelope.data !== null
        ? record(envelope.data)
        : {};
    if (event === "subscribed") {
      const id = asString(data.id);
      const symbol = asString(data.symbol);
      const channel = asString(data.channel);
      const match = [...this.#subscriptions.entries()].find(
        ([, subscription]) =>
          (subscription.security_type === "STK" ? "stock" : "futopt") ===
            product &&
          (subscription.target_code || subscription.code) === symbol &&
          channelFor(subscription) === channel &&
          (product === "futopt" ||
            subscription.intraday_odd === (data.intradayOddLot === true)),
      );
      if (match && id) this.#upstreamIds.set(match[0], id);
      return;
    }
    const mapped = mapUpstreamEvent(event, data, product);
    if (!mapped) return;
    const encoded = new TextEncoder().encode(
      formatSse(mapped.event, mapped.data),
    );
    for (const client of this.#clients) {
      if (client.event === undefined || client.event === mapped.event) {
        try {
          client.controller.enqueue(encoded);
        } catch {}
      }
    }
  }

  private onTradingEvent(event: {
    kind: "order" | "orderChanged" | "filled";
    code: string;
    content: unknown;
  }): void {
    const content = record(event.content);
    const key = `${asString(content.branchNo)}:${asString(content.account)}`;
    if (!this.connector.simulation && !this.#tradeSubscriptions.has(key))
      return;
    const future =
      asNumber(content.assetType) > 0 ||
      content.expiryDate !== undefined ||
      content.lot !== undefined;
    const state =
      event.kind === "filled"
        ? future
          ? "FuturesDeal"
          : "StockDeal"
        : future
          ? "FuturesOrder"
          : "StockOrder";
    const payload = {
      state,
      data: {
        [state]:
          event.kind === "filled"
            ? mapTradingDeal(content, future)
            : mapTradingOrder(content, event.code, future),
      },
    };
    const encoded = new TextEncoder().encode(formatSse("order_event", payload));
    for (const client of this.#clients) {
      if (client.event === undefined || client.event === "order_event") {
        try {
          client.controller.enqueue(encoded);
        } catch {}
      }
    }
  }
}

function parseSubscription(body: Record<string, unknown>): Subscription {
  assertAllowedFields(body, [
    "security_type",
    "exchange",
    "code",
    "target_code",
    "quote_type",
    "intraday_odd",
  ]);
  const quoteType = stringField(body, "quote_type", true)!;
  if (!["Tick", "BidAsk", "Quote"].includes(quoteType)) {
    throw new BridgeHttpError(400, "quote_type must be Tick, BidAsk, or Quote");
  }
  return {
    security_type: stringField(body, "security_type", true)!,
    exchange: stringField(body, "exchange", true)!,
    code: stringField(body, "code", true)!,
    target_code:
      body.target_code === null ? null : stringField(body, "target_code"),
    quote_type: quoteType,
    intraday_odd: body.intraday_odd === true,
  };
}

function subscriptionKey(value: Subscription): string {
  return `${value.security_type}:${value.code}:${value.quote_type}:${value.intraday_odd}`;
}

function socketId(product: "stock" | "futopt"): string {
  return `shioaji-bridge-stream-${product}`;
}

function productForSocket(id: string): "stock" | "futopt" | undefined {
  if (id === socketId("stock")) return "stock";
  if (id === socketId("futopt")) return "futopt";
  return undefined;
}

function channelFor(value: Subscription): string {
  if (value.quote_type === "Tick") return "trades";
  if (value.quote_type === "BidAsk") return "books";
  return "aggregates";
}

function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function mapUpstreamEvent(
  event: string,
  data: Record<string, unknown>,
  product: "stock" | "futopt",
): { event: string; data: unknown } | undefined {
  const suffix = product === "stock" ? "stk" : "fop";
  if (event === "data") {
    const type = asString(data.type);
    if (type === "trade")
      return { event: `tick_${suffix}`, data: mapTick(data) };
    if (type === "book")
      return { event: `bidask_${suffix}`, data: mapBook(data) };
    if (type === "aggregate")
      return { event: `quote_${suffix}`, data: mapTick(data) };
  }
  if (event === "trades")
    return { event: `tick_${suffix}`, data: mapTick(data) };
  if (event === "books")
    return { event: `bidask_${suffix}`, data: mapBook(data) };
  if (event === "aggregates")
    return { event: `quote_${suffix}`, data: mapTick(data) };
  return undefined;
}

function mapTick(data: Record<string, unknown>): Record<string, unknown> {
  const price = asNumber(data.price ?? data.closePrice);
  return {
    code: asString(data.symbol),
    datetime: formatTimestamp(data.time ?? data.lastUpdated),
    open: asNumber(data.openPrice),
    high: asNumber(data.highPrice),
    low: asNumber(data.lowPrice),
    close: price,
    avg_price: asNumber(data.avgPrice),
    volume: asNumber(data.size),
    total_volume: asNumber(data.volume ?? data.tradeVolume),
    amount: price * asNumber(data.size),
    total_amount: asNumber(data.tradeValue),
    tick_type: 0,
    chg_type: asNumber(data.change) > 0 ? 1 : asNumber(data.change) < 0 ? 2 : 0,
    price_chg: asNumber(data.change),
    pct_chg: asNumber(data.changePercent),
    intraday_odd: data.intradayOddLot === true,
  };
}

function mapBook(data: Record<string, unknown>): Record<string, unknown> {
  const bids = Array.isArray(data.bids) ? data.bids.map(record) : [];
  const asks = Array.isArray(data.asks) ? data.asks.map(record) : [];
  return {
    code: asString(data.symbol),
    datetime: formatTimestamp(data.time ?? data.lastUpdated),
    bid_price: bids.map((item) => asNumber(item.price)),
    bid_volume: bids.map((item) => asNumber(item.size)),
    ask_price: asks.map((item) => asNumber(item.price)),
    ask_volume: asks.map((item) => asNumber(item.size)),
    diff_bid_vol: bids.map(() => 0),
    diff_ask_vol: asks.map(() => 0),
    intraday_odd: data.intradayOddLot === true,
  };
}

function mapTradingOrder(
  data: Record<string, unknown>,
  code: string,
  future: boolean,
): Record<string, unknown> {
  const orderId = asString(data.seqNo || data.orderNo);
  return {
    operation: {
      op_type: asNumber(data.functionType) === 30 ? "Cancel" : "New",
      op_code: code,
      op_msg: asString(data.errorMessage),
    },
    order: {
      id: orderId,
      seqno: asString(data.seqNo),
      ordno: asString(data.orderNo),
      action: data.buySell === "Sell" ? "Sell" : "Buy",
      price: asNumber(data.price),
      quantity: asNumber(future ? data.lot : data.quantity),
    },
    status: {
      id: orderId,
      status_code: asString(data.status),
      order_quantity: asNumber(future ? data.lot : data.quantity),
      deal_quantity: asNumber(future ? data.filledLot : data.filledQty),
      message: asString(data.errorMessage),
    },
    contract: {
      security_type: future
        ? asNumber(data.assetType) === 2
          ? "OPT"
          : "FUT"
        : "STK",
      exchange: future ? "TAIFEX" : data.market === "TAISDAQ" ? "OTC" : "TSE",
      code: future
        ? `${asString(data.symbol)}${asString(data.expiryDate)}`
        : asString(data.stockNo),
    },
  };
}

function mapTradingDeal(
  data: Record<string, unknown>,
  future: boolean,
): Record<string, unknown> {
  return {
    trade_id: asString(data.seqNo || data.orderNo),
    seqno: asString(data.seqNo),
    ordno: asString(data.orderNo),
    broker_id: asString(data.branchNo),
    account_id: asString(data.account),
    action: data.buySell === "Sell" ? "Sell" : "Buy",
    code: future
      ? `${asString(data.symbol)}${asString(data.expiryDate)}`
      : asString(data.stockNo),
    price: asNumber(data.filledPrice),
    quantity: asNumber(future ? data.filledLot : data.filledQty),
    security_type: future ? (data.callPut ? "OPT" : "FUT") : "STK",
    ts: `${asString(data.date)} ${asString(data.filledTime)}`.trim(),
  };
}
