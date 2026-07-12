import type { FubonProxyInvocation } from "../proxy/fubon-proxy-types.ts";
import {
  asNumber,
  asString,
  assertAllowedFields,
  BridgeHttpError,
  type BridgeConnector,
  formatShioajiDate,
  readJsonObject,
  record,
  records,
  selectAccount,
  stringField,
  unwrapFubon,
  unsupported,
} from "./common.ts";

const ACCOUNT_FIELDS = ["account_type", "broker_id", "account_id", "person_id"];

export async function handlePortfolio(
  connector: BridgeConnector,
  path: string,
  request: Request,
  now: () => Date,
): Promise<Response> {
  if (path === "/api/v1/portfolio/position_detail") {
    unsupported(path, "position_detail has no stable Fubon detail ID mapping");
  }
  if (path === "/api/v1/portfolio/profit_loss_detail") {
    unsupported(
      path,
      "profit_loss_detail has no stable Fubon detail ID mapping",
    );
  }

  const body = await readJsonObject(request);
  switch (path) {
    case "/api/v1/portfolio/account_balance":
      return accountBalance(connector, body, now);
    case "/api/v1/portfolio/margin":
      return margin(connector, body);
    case "/api/v1/portfolio/position_unit":
      return positions(connector, body);
    case "/api/v1/portfolio/settlements":
      return settlements(connector, body, false);
    case "/api/v1/portfolio/settlement":
      return settlements(connector, body, true);
    case "/api/v1/portfolio/profit_loss":
      return profitLoss(connector, body);
    case "/api/v1/portfolio/profitloss_sum":
      return profitLossSummary(connector, body);
    case "/api/v1/portfolio/trading_limits":
      unsupported(
        path,
        "Fubon maintenance data is not equivalent to Shioaji trading limits",
      );
    default:
      unsupported(path);
  }
}

async function invoke(
  connector: BridgeConnector,
  invocation: FubonProxyInvocation,
): Promise<unknown> {
  return connector.invokeProxy(invocation);
}

async function accountBalance(
  connector: BridgeConnector,
  body: Record<string, unknown>,
  now: () => Date,
): Promise<Response> {
  assertAllowedFields(body, ACCOUNT_FIELDS);
  const account = selectAccount(connector.accounts, body, "S");
  if (body.account_type !== undefined && body.account_type !== "S") {
    throw new BridgeHttpError(400, 'account_type must be "S"');
  }
  const raw = await invoke(connector, {
    target: { service: "accounting", methodPath: ["bankRemain"] },
    arguments: [account],
  });
  const result = raw as {
    isSuccess?: boolean;
    data?: unknown;
    message?: string;
  };
  const date = formatShioajiDate(now());
  if (result?.isSuccess === false) {
    return Response.json({
      acc_balance: 0,
      date,
      errmsg: result.message ?? "Query failed",
    });
  }
  const data = record(unwrapFubon(raw, "bankRemain"));
  return Response.json({
    acc_balance: asNumber(data.availableBalance),
    date,
    errmsg: "",
  });
}

async function margin(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, ACCOUNT_FIELDS);
  const account = selectAccount(connector.accounts, body, "F");
  const values = records(
    unwrapFubon(
      await invoke(connector, {
        target: {
          service: "futoptAccounting",
          methodPath: ["queryMarginEquity"],
        },
        arguments: [account],
      }),
      "queryMarginEquity",
    ),
  );
  const data =
    values.find((item) => item.currency === "TWD") ?? values[0] ?? {};
  return Response.json({
    yesterday_balance: asNumber(data.yesterdayBalance),
    today_balance: asNumber(data.todayBalance),
    deposit_withdrawal:
      asNumber(data.todayDeposit) - asNumber(data.todayWithdrawal),
    fee: asNumber(data.todayTradingFee),
    tax: asNumber(data.todayTradingTax),
    initial_margin: asNumber(data.initialMargin),
    maintenance_margin: asNumber(data.maintenanceMargin),
    margin_call: asNumber(data.disgorgement),
    risk_indicator: 0,
    royalty_revenue_expenditure:
      asNumber(data.receivablePremium) - asNumber(data.payablePremium),
    equity: asNumber(data.todayEquity),
    equity_amount: asNumber(data.todayEquity),
    option_openbuy_market_value: asNumber(data.optLongValue),
    option_opensell_market_value: asNumber(data.optShortValue),
    option_open_position: asNumber(data.optPnl),
    option_settle_profitloss: 0,
    future_open_position: asNumber(data.futUnrealizedPnl),
    today_future_open_position: asNumber(data.futUnrealizedPnl),
    future_settle_profitloss: asNumber(data.futRealizedPnl),
    available_margin: asNumber(data.availableMargin),
    plus_margin: 0,
    plus_margin_indicator: 0,
    security_collateral_amount: 0,
    order_margin_premium: 0,
    collateral_amount: 0,
  });
}

async function positions(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, [...ACCOUNT_FIELDS, "unit"]);
  const unit = stringField(body, "unit") ?? "Common";
  if (unit !== "Common" && unit !== "Share") {
    throw new BridgeHttpError(400, 'unit must be "Common" or "Share"');
  }
  const type = body.account_type === "F" ? "F" : "S";
  const account = selectAccount(connector.accounts, body, type);
  if (type === "F") {
    const data = records(
      unwrapFubon(
        await invoke(connector, {
          target: {
            service: "futoptAccounting",
            methodPath: ["querySinglePosition"],
          },
          arguments: [account],
        }),
        "querySinglePosition",
      ),
    );
    return Response.json(data.map(mapFuturePosition));
  }

  const [unrealizedResult, inventoriesResult] = await Promise.all([
    invoke(connector, {
      target: {
        service: "accounting",
        methodPath: ["unrealizedGainsAndLoses"],
      },
      arguments: [account],
    }),
    invoke(connector, {
      target: { service: "accounting", methodPath: ["inventories"] },
      arguments: [account],
    }),
  ]);
  const data = records(
    unwrapFubon(unrealizedResult, "unrealizedGainsAndLoses"),
  );
  const inventories = records(unwrapFubon(inventoriesResult, "inventories"));
  return Response.json(
    data.map((item, index) =>
      mapStockPosition(
        item,
        index,
        unit,
        inventories.find(
          (inventory) =>
            inventory.stockNo === item.stockNo &&
            inventory.orderType === item.orderType,
        ),
      ),
    ),
  );
}

function mapStockPosition(
  item: Record<string, unknown>,
  index: number,
  unit: string,
  inventory?: Record<string, unknown>,
): Record<string, unknown> {
  const odd =
    inventory && typeof inventory.odd === "object" && inventory.odd !== null
      ? record(inventory.odd)
      : {};
  const regularQuantity = asNumber(inventory?.todayQty ?? item.todayQty);
  const rawQuantity =
    unit === "Share"
      ? regularQuantity + asNumber(odd.todayQty)
      : regularQuantity;
  const quantity = unit === "Common" ? rawQuantity / 1000 : rawQuantity;
  const pnl = asNumber(item.unrealizedProfit) - asNumber(item.unrealizedLoss);
  const price = asNumber(item.costPrice);
  return {
    id: index,
    code: asString(item.stockNo),
    direction: item.buySell === "Sell" ? "Sell" : "Buy",
    quantity,
    price,
    last_price: rawQuantity === 0 ? price : price + pnl / rawQuantity,
    pnl,
    yd_quantity:
      unit === "Common"
        ? asNumber(inventory?.lastdayQty ?? item.tradableQty) / 1000
        : asNumber(inventory?.lastdayQty ?? item.tradableQty) +
          asNumber(odd.lastdayQty),
    cond: mapStockCondition(item.orderType),
    margin_purchase_amount: 0,
    collateral: 0,
    short_sale_margin: 0,
    interest: 0,
  };
}

function mapFuturePosition(
  item: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const quantity = asNumber(item.origLots);
  const pnl = asNumber(item.profitOrLoss);
  const price = asNumber(item.price);
  const optionSuffix =
    asNumber(item.positionKind) === 2
      ? `${asString(item.strikePrice)}${item.callPut === "Put" ? "P" : "C"}`
      : "";
  return {
    id: index,
    code: asString(item.symbol) + asString(item.expiryDate) + optionSuffix,
    direction: item.buySell === "Sell" ? "Sell" : "Buy",
    quantity,
    price,
    last_price: asNumber(item.marketPrice, price),
    pnl,
  };
}

async function settlements(
  connector: BridgeConnector,
  body: Record<string, unknown>,
  legacy: boolean,
): Promise<Response> {
  assertAllowedFields(body, ACCOUNT_FIELDS);
  const account = selectAccount(connector.accounts, body, "S");
  const data = record(
    unwrapFubon(
      await invoke(connector, {
        target: { service: "accounting", methodPath: ["querySettlement"] },
        arguments: [account, "3d"],
      }),
      "querySettlement",
    ),
  );
  const details = records(data.details ?? []);
  const mapped = details.slice(0, 3).map((item, index) => ({
    date: normalizeDate(asString(item.settlementDate || item.date)),
    amount: asNumber(item.totalSettlementAmount),
    T: index,
  }));
  if (!legacy) return Response.json(mapped);
  return Response.json({
    t_money: mapped[0]?.amount ?? 0,
    t1_money: mapped[1]?.amount ?? 0,
    t2_money: mapped[2]?.amount ?? 0,
    t_day: mapped[0]?.date ?? "",
    t1_day: mapped[1]?.date ?? "",
    t2_day: mapped[2]?.date ?? "",
  });
}

async function profitLoss(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, [
    ...ACCOUNT_FIELDS,
    "begin_date",
    "end_date",
    "unit",
  ]);
  if (body.account_type === "F") {
    unsupported(
      "/api/v1/portfolio/profit_loss",
      "Fubon futures close-position records cannot preserve Shioaji profit/loss IDs",
    );
  }
  const account = selectAccount(connector.accounts, body, "S");
  const begin = stringField(body, "begin_date");
  const end = stringField(body, "end_date");
  const data = records(
    unwrapFubon(
      await invoke(connector, {
        target: {
          service: "accounting",
          methodPath: ["realizedGainsAndLoses"],
        },
        arguments: [account],
      }),
      "realizedGainsAndLoses",
    ),
  ).filter((item) =>
    withinRange(normalizeDate(asString(item.date)), begin, end),
  );
  return Response.json(
    data.map((item, index) => ({
      id: index,
      code: asString(item.stockNo),
      quantity: asNumber(item.filledQty) / 1000,
      pnl: asNumber(item.realizedProfit) - asNumber(item.realizedLoss),
      date: normalizeDate(asString(item.date)),
      dseq: "",
      price: asNumber(item.filledPrice),
      pr_ratio: 0,
      cond: mapStockCondition(item.orderType),
      seqno: "",
    })),
  );
}

async function profitLossSummary(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, [...ACCOUNT_FIELDS, "begin_date", "end_date"]);
  if (body.account_type === "F") {
    unsupported(
      "/api/v1/portfolio/profitloss_sum",
      "Fubon futures summary is not equivalent to Shioaji ProfitLossSummaryTotal",
    );
  }
  const account = selectAccount(connector.accounts, body, "S");
  const data = records(
    unwrapFubon(
      await invoke(connector, {
        target: {
          service: "accounting",
          methodPath: ["realizedGainsAndLosesSummary"],
        },
        arguments: [account],
      }),
      "realizedGainsAndLosesSummary",
    ),
  );
  const summary = data.map((item) => ({
    code: asString(item.stockNo),
    quantity: asNumber(item.filledQty) / 1000,
    entry_price: 0,
    cover_price: asNumber(item.filledAvgPrice),
    pnl: asNumber(item.realizedProfitAndLoss),
    pr_ratio: 0,
    cond: mapStockCondition(item.orderType),
  }));
  return Response.json({
    profitloss_summary: summary,
    total: {
      pnl: summary.reduce((sum, item) => sum + item.pnl, 0),
      pr_ratio: 0,
    },
  });
}

function mapStockCondition(value: unknown): string {
  if (value === "Margin") return "MarginTrading";
  if (value === "Short") return "ShortSelling";
  if (value === "DayTrade") return "Netting";
  if (value === "SBL") return "ShortSelling";
  return "Cash";
}

function normalizeDate(value: string): string {
  if (/^\d{8}$/.test(value))
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  return value.replaceAll("/", "-");
}

function withinRange(value: string, begin?: string, end?: string): boolean {
  return (!begin || value >= begin) && (!end || value <= end);
}
