import type { FubonAccount } from "../connectors/fubon-connector.ts";
import type { OrderStore, StoredOrder } from "./order-store.ts";
import {
  asNumber,
  asString,
  assertAllowedFields,
  BridgeHttpError,
  type BridgeConnector,
  objectField,
  readJsonObject,
  record,
  records,
  selectAccount,
  stringField,
  unwrapFubon,
  unsupported,
} from "./common.ts";

export async function handleOrders(
  connector: BridgeConnector,
  orderStore: OrderStore,
  path: string,
  request: Request,
): Promise<Response> {
  if (
    [
      "/api/v1/order/place_comboorder",
      "/api/v1/order/cancel_comboorder",
      "/api/v1/order/combotrades",
    ].includes(path)
  ) {
    unsupported(path, "No equivalent Fubon combo-order workflow is available");
  }
  if (
    [
      "/api/v1/order/stock_reserve_summary",
      "/api/v1/order/stock_reserve_detail",
      "/api/v1/order/reserve_stock",
      "/api/v1/order/earmarking_detail",
      "/api/v1/order/reserve_earmarking",
    ].includes(path)
  ) {
    unsupported(
      path,
      "No equivalent Fubon stock reserve or earmarking workflow is available",
    );
  }

  const body = await readJsonObject(request);
  switch (path) {
    case "/api/v1/order/place_order":
      return placeOrder(connector, orderStore, body);
    case "/api/v1/order/cancel_order":
      return changeOrder(connector, orderStore, body, "cancel");
    case "/api/v1/order/update_price":
      return changeOrder(connector, orderStore, body, "price");
    case "/api/v1/order/update_qty":
      return changeOrder(connector, orderStore, body, "quantity");
    case "/api/v1/order/trades":
      return trades(connector, orderStore, body);
    case "/api/v1/order/order_deal_records":
      return orderDealRecords(connector, orderStore, body);
    default:
      unsupported(path);
  }
}

async function placeOrder(
  connector: BridgeConnector,
  orderStore: OrderStore,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, ["contract", "stock_order", "futures_order"]);
  const contract = objectField(body, "contract", true)!;
  const securityType = stringField(contract, "security_type", true)!;
  const code =
    stringField(contract, "target_code") ??
    stringField(contract, "code", true)!;
  if (securityType === "STK") {
    const order = objectField(body, "stock_order", true)!;
    const account = accountFromOrder(connector.accounts, order, "S");
    const fubonOrder = mapStockOrder(order, code);
    const result = record(
      unwrapFubon(
        await connector.invokeProxy({
          target: { service: "stock", methodPath: ["placeOrder"] },
          arguments: [account, fubonOrder, false],
        }),
        "stock.placeOrder",
      ),
    );
    const trade = mapTrade(result, contract, order, false);
    persistOrder(orderStore, account, result, contract, order, false);
    return Response.json(trade);
  }
  if (securityType === "FUT" || securityType === "OPT") {
    const order = objectField(body, "futures_order", true)!;
    const account = accountFromOrder(connector.accounts, order, "F");
    const fubonOrder = mapFuturesOrder(order, code, securityType);
    const result = record(
      unwrapFubon(
        await connector.invokeProxy({
          target: { service: "futopt", methodPath: ["placeOrder"] },
          arguments: [account, fubonOrder, false],
        }),
        "futopt.placeOrder",
      ),
    );
    const trade = mapTrade(result, contract, order, true);
    persistOrder(orderStore, account, result, contract, order, true);
    return Response.json(trade);
  }
  throw new BridgeHttpError(
    400,
    "contract.security_type must be STK, FUT, or OPT",
  );
}

function accountFromOrder(
  accounts: readonly FubonAccount[],
  order: Record<string, unknown>,
  type: "S" | "F",
): FubonAccount {
  const selector = objectField(order, "account") ?? {};
  return selectAccount(
    accounts,
    {
      account_type: type,
      broker_id:
        typeof selector.broker_id === "string" ? selector.broker_id : undefined,
      account_id:
        typeof selector.account_id === "string"
          ? selector.account_id
          : undefined,
      person_id:
        typeof selector.person_id === "string" || selector.person_id === null
          ? selector.person_id
          : undefined,
    },
    type,
  );
}

function mapStockOrder(
  order: Record<string, unknown>,
  code: string,
): Record<string, unknown> {
  const action = enumValue(order, "action", ["Buy", "Sell"]);
  const priceType = enumValue(order, "price_type", ["LMT", "MKT", "MKP"]);
  const timeInForce = enumValue(order, "order_type", ["ROD", "IOC", "FOK"]);
  const lot =
    order.order_lot === undefined
      ? "Common"
      : enumValue(order, "order_lot", [
          "Common",
          "Odd",
          "IntradayOdd",
          "Fixing",
        ]);
  const condition =
    order.order_cond === undefined
      ? "Cash"
      : enumValue(order, "order_cond", [
          "Cash",
          "MarginTrading",
          "ShortSelling",
          "Netting",
        ]);
  const quantity = requiredPositiveNumber(order, "quantity");
  return {
    buySell: action,
    symbol: code,
    price: requiredNumber(order, "price"),
    quantity: lot === "Common" || lot === "Fixing" ? quantity * 1000 : quantity,
    marketType: lot,
    priceType:
      priceType === "LMT"
        ? "Limit"
        : priceType === "MKT"
          ? "Market"
          : "Reference",
    timeInForce,
    orderType:
      condition === "MarginTrading"
        ? "Margin"
        : condition === "ShortSelling"
          ? "Short"
          : "Stock",
    userDef: asString(order.custom_field).slice(0, 10),
  };
}

function mapFuturesOrder(
  order: Record<string, unknown>,
  code: string,
  securityType: string,
): Record<string, unknown> {
  const action = enumValue(order, "action", ["Buy", "Sell"]);
  const priceType = enumValue(order, "price_type", ["LMT", "MKT", "MKP"]);
  const timeInForce = enumValue(order, "order_type", ["ROD", "IOC", "FOK"]);
  if (priceType === "MKT" && timeInForce === "ROD") {
    throw new BridgeHttpError(400, "TAIFEX does not accept MKT with ROD");
  }
  const openClose =
    order.octype === undefined
      ? "Auto"
      : enumValue(order, "octype", [
          "Auto",
          "New",
          "NewPosition",
          "Cover",
          "DayTrade",
        ]);
  return {
    buySell: action,
    symbol: code,
    price: requiredNumber(order, "price"),
    lot: requiredPositiveNumber(order, "quantity"),
    marketType: securityType === "OPT" ? "Option" : "Future",
    priceType:
      priceType === "LMT"
        ? "Limit"
        : priceType === "MKT"
          ? "Market"
          : "RangeMarket",
    timeInForce,
    orderType:
      openClose === "Cover"
        ? "Close"
        : openClose === "DayTrade"
          ? "FdayTrade"
          : openClose.startsWith("New")
            ? "New"
            : "Auto",
    userDef: asString(order.custom_field).slice(0, 10),
  };
}

type OrderChange = "cancel" | "price" | "quantity";

async function changeOrder(
  connector: BridgeConnector,
  orderStore: OrderStore,
  body: Record<string, unknown>,
  change: OrderChange,
): Promise<Response> {
  const allowed =
    change === "price"
      ? ["trade_id", "price"]
      : change === "quantity"
        ? ["trade_id", "quantity"]
        : ["trade_id"];
  assertAllowedFields(body, allowed);
  const tradeId = stringField(body, "trade_id", true)!;
  const stored = orderStore.get(tradeId);
  if (!stored) {
    throw new BridgeHttpError(404, `Trade not found: ${tradeId}`);
  }

  const account = selectAccount(
    connector.accounts,
    {
      account_type: stored.accountType,
      broker_id: stored.brokerId,
      account_id: stored.accountId,
    },
    stored.accountType,
  );
  const service = stored.future ? "futopt" : "stock";
  let method: string;
  let argument: Record<string, unknown> = stored.orderResult;

  if (change === "cancel") {
    method = "cancelOrder";
  } else if (change === "price") {
    const price = requiredPositiveNumber(body, "price");
    method = "modifyPrice";
    argument = record(
      await connector.invokeProxy({
        target: { service, methodPath: ["makeModifyPriceObj"] },
        arguments: [stored.orderResult, String(price)],
      }),
    );
  } else {
    const quantity = requiredPositiveInteger(body, "quantity");
    const currentQuantity = effectiveQuantity(stored);
    if (quantity >= currentQuantity) {
      throw new BridgeHttpError(
        400,
        `quantity must be less than the current quantity (${currentQuantity})`,
      );
    }
    method = stored.future ? "modifyLot" : "modifyQuantity";
    const factory = stored.future
      ? "makeModifyLotObj"
      : "makeModifyQuantityObj";
    argument = record(
      await connector.invokeProxy({
        target: { service, methodPath: [factory] },
        arguments: [stored.orderResult, brokerQuantity(stored, quantity)],
      }),
    );
  }

  const result = record(
    unwrapFubon(
      await connector.invokeProxy({
        target: { service, methodPath: [method] },
        arguments: [account, argument, false],
      }),
      `${service}.${method}`,
    ),
  );
  orderStore.put({ ...stored, orderResult: result });
  return Response.json(
    mapTrade(
      result,
      stored.contract,
      stored.orderInput,
      stored.future,
      tradeId,
    ),
  );
}

function persistOrder(
  orderStore: OrderStore,
  account: FubonAccount,
  orderResult: Record<string, unknown>,
  contract: Record<string, unknown>,
  orderInput: Record<string, unknown>,
  future: boolean,
): void {
  const tradeId = asString(orderResult.seqNo || orderResult.orderNo);
  if (!tradeId) throw new Error("Fubon order result has no trade identifier");
  orderStore.put({
    tradeId,
    accountType: future ? "F" : "S",
    brokerId: account.branchNo,
    accountId: account.account,
    future,
    contract,
    orderInput,
    orderResult,
  });
}

function brokerQuantity(stored: StoredOrder, quantity: number): number {
  if (stored.future) return quantity;
  const lot = asString(stored.orderInput.order_lot, "Common");
  return lot === "Common" || lot === "Fixing" ? quantity * 1000 : quantity;
}

function effectiveQuantity(stored: StoredOrder): number {
  if (stored.future) {
    return asNumber(
      stored.orderResult.afterLot,
      asNumber(stored.orderInput.quantity),
    );
  }
  const unit = Math.max(1, asNumber(stored.orderResult.unit, 1000));
  const fallback = brokerQuantity(stored, asNumber(stored.orderInput.quantity));
  return asNumber(stored.orderResult.afterQty, fallback) / unit;
}

async function trades(
  connector: BridgeConnector,
  orderStore: OrderStore,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, [
    "account_type",
    "broker_id",
    "account_id",
    "person_id",
  ]);
  const type = body.account_type === "F" ? "F" : "S";
  const account = selectAccount(connector.accounts, body, type);
  const isFuture = type === "F";
  const data = records(
    unwrapFubon(
      await connector.invokeProxy({
        target: {
          service: isFuture ? "futopt" : "stock",
          methodPath: ["getOrderResults"],
        },
        arguments: [account],
      }),
      "getOrderResults",
    ),
  );
  return Response.json(
    data.map((item) => {
      const trade = mapTradeFromResult(item, isFuture);
      persistOrder(
        orderStore,
        account,
        item,
        record(trade.contract),
        record(trade.order),
        isFuture,
      );
      return trade;
    }),
  );
}

async function orderDealRecords(
  connector: BridgeConnector,
  orderStore: OrderStore,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await trades(connector, orderStore, body);
  const values = (await response.json()) as Record<string, unknown>[];
  return Response.json(
    values.map((trade) => {
      const future = record(trade.contract).security_type !== "STK";
      const state = future ? "FuturesOrder" : "StockOrder";
      return { state, data: { [state]: trade } };
    }),
  );
}

function mapTradeFromResult(
  item: Record<string, unknown>,
  future: boolean,
): Record<string, unknown> {
  const contract = future
    ? {
        security_type: asNumber(item.assetType) === 2 ? "OPT" : "FUT",
        exchange: "TAIFEX",
        code: `${asString(item.symbol)}${asString(item.expiryDate)}`,
      }
    : {
        security_type: "STK",
        exchange: item.market === "TAISDAQ" ? "OTC" : "TSE",
        code: asString(item.stockNo),
      };
  const order = {
    action: item.buySell === "Sell" ? "Sell" : "Buy",
    price: asNumber(item.price),
    quantity: future
      ? asNumber(item.lot)
      : asNumber(item.quantity) / Math.max(1, asNumber(item.unit, 1000)),
    price_type: reversePriceType(item.priceType, future),
    order_type: asString(item.timeInForce, "ROD"),
    order_lot: future ? undefined : reverseMarketType(item.marketType),
    order_cond: future ? undefined : reverseCondition(item.orderType),
  };
  return mapTrade(item, contract, order, future);
}

function mapTrade(
  result: Record<string, unknown>,
  contract: Record<string, unknown>,
  orderInput: Record<string, unknown>,
  future: boolean,
  tradeId?: string,
): Record<string, unknown> {
  const stockUnit = Math.max(1, asNumber(result.unit, 1000));
  const quantity = future
    ? asNumber(result.lot, asNumber(orderInput.quantity))
    : result.quantity !== undefined
      ? asNumber(result.quantity) / stockUnit
      : asNumber(orderInput.quantity);
  const filledRaw = asNumber(future ? result.filledLot : result.filledQty);
  const filled = future ? filledRaw : filledRaw / stockUnit;
  const effectiveQuantity = future
    ? asNumber(result.afterLot, quantity)
    : asNumber(result.afterQty, quantity * stockUnit) / stockUnit;
  const id = tradeId ?? asString(result.seqNo || result.orderNo);
  return {
    contract,
    order: {
      id,
      seqno: asString(result.seqNo),
      ordno: asString(result.orderNo),
      action: result.buySell ?? orderInput.action,
      price: asNumber(result.afterPrice ?? result.price ?? orderInput.price),
      quantity: asNumber(result.status) === 30 ? quantity : effectiveQuantity,
      price_type:
        orderInput.price_type ?? reversePriceType(result.priceType, future),
      order_type: orderInput.order_type ?? asString(result.timeInForce, "ROD"),
      order_lot: orderInput.order_lot,
      order_cond: orderInput.order_cond,
      custom_field: asString(result.userDef ?? orderInput.custom_field),
    },
    status: {
      id,
      status: mapOrderStatus(asNumber(result.status), filled, quantity),
      status_code: asString(result.status),
      order_quantity: effectiveQuantity,
      deal_quantity: filled,
      cancel_quantity: Math.max(0, quantity - effectiveQuantity),
      modified_price: asNumber(result.afterPrice ?? result.price),
      order_ts: `${asString(result.date)} ${asString(result.lastTime)}`.trim(),
      modified_ts:
        `${asString(result.date)} ${asString(result.lastTime)}`.trim(),
      deals: [],
      message: asString(result.errorMessage),
    },
  };
}

function mapOrderStatus(
  status: number,
  filled: number,
  quantity: number,
): string {
  if (status === 90 || status === 9) return "Failed";
  if (status === 30) return "Cancelled";
  if (status === 50 || (quantity > 0 && filled >= quantity)) return "Filled";
  if (filled > 0) return "PartFilled";
  if (status === 0) return "PreSubmitted";
  if (status === 10) return "Submitted";
  return "PendingSubmit";
}

function reversePriceType(value: unknown, future: boolean): string {
  if (value === "Market") return "MKT";
  if (value === "RangeMarket" || value === "Reference") return "MKP";
  return "LMT";
}

function reverseMarketType(value: unknown): string {
  return ["Common", "Odd", "IntradayOdd", "Fixing"].includes(asString(value))
    ? asString(value)
    : "Common";
}

function reverseCondition(value: unknown): string {
  if (value === "Margin") return "MarginTrading";
  if (value === "Short") return "ShortSelling";
  return "Cash";
}

function enumValue(
  object: Record<string, unknown>,
  field: string,
  values: readonly string[],
): string {
  const value = stringField(object, field, true)!;
  if (!values.includes(value)) {
    throw new BridgeHttpError(
      400,
      `${field} must be one of ${values.join(", ")}`,
    );
  }
  return value;
}

function requiredNumber(
  object: Record<string, unknown>,
  field: string,
): number {
  if (typeof object[field] !== "number" || !Number.isFinite(object[field])) {
    throw new BridgeHttpError(400, `${field} must be a number`);
  }
  return object[field] as number;
}

function requiredPositiveNumber(
  object: Record<string, unknown>,
  field: string,
): number {
  const value = requiredNumber(object, field);
  if (value <= 0)
    throw new BridgeHttpError(400, `${field} must be greater than zero`);
  return value;
}

function requiredPositiveInteger(
  object: Record<string, unknown>,
  field: string,
): number {
  const value = requiredPositiveNumber(object, field);
  if (!Number.isInteger(value)) {
    throw new BridgeHttpError(400, `${field} must be an integer`);
  }
  return value;
}
