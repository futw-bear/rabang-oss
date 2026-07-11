import type {
  FubonProxyService,
  FubonProxyTarget,
} from "./fubon-proxy-types.ts";

export type ProxyHttpMethod = "GET" | "POST";

interface OrderedProxyEndpoint {
  httpMethod: ProxyHttpMethod;
  target: FubonProxyTarget;
  parameterNames: readonly string[];
  requiredParameterCount: number;
  argumentStyle: "ordered";
  pathParameterNames?: never;
}

interface ObjectProxyEndpoint {
  httpMethod: "GET";
  target: FubonProxyTarget;
  argumentStyle: "object";
  pathParameterNames?: readonly string[];
}

export type FubonProxyEndpoint =
  | OrderedProxyEndpoint
  | ObjectProxyEndpoint;

type EndpointEntry = readonly [path: string, endpoint: FubonProxyEndpoint];

const QUERY = "GET" as const;
const MUTATION = "POST" as const;

function target(
  service: FubonProxyService,
  ...methodPath: string[]
): FubonProxyTarget {
  return { service, methodPath };
}

function ordered(
  path: string,
  httpMethod: ProxyHttpMethod,
  service: FubonProxyService,
  methodPath: string[],
  requiredParameterNames: string[],
  optionalParameterNames: string[] = [],
): EndpointEntry {
  return [
    `/proxy/${path}`,
    {
      httpMethod,
      target: target(service, ...methodPath),
      parameterNames: [...requiredParameterNames, ...optionalParameterNames],
      requiredParameterCount: requiredParameterNames.length,
      argumentStyle: "ordered",
    },
  ];
}

function marketData(
  product: "market-data" | "market-data-future",
  service: "marketDataStock" | "marketDataFutopt",
  group: string,
  routeName: string,
  sdkMethod = routeName,
): EndpointEntry {
  return [
    `/proxy/${product}/${group}/${routeName}`,
    {
      httpMethod: QUERY,
      target: target(service, group.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), sdkMethod),
      argumentStyle: "object",
      pathParameterNames: marketDataPathParameterNames(
        product,
        group,
        routeName,
      ),
    },
  ];
}

function marketDataPathParameterNames(
  product: "market-data" | "market-data-future",
  group: string,
  routeName: string,
): readonly string[] | undefined {
  return MARKET_DATA_PATH_PARAMETERS.get(
    `${product}/${group}/${routeName}`,
  );
}

const MARKET_DATA_PATH_PARAMETERS: ReadonlyMap<string, readonly string[]> =
  new Map([
    ["market-data/intraday/ticker", ["symbol"]],
    ["market-data/intraday/quote", ["symbol"]],
    ["market-data/intraday/candles", ["symbol"]],
    ["market-data/intraday/trades", ["symbol"]],
    ["market-data/intraday/volumes", ["symbol"]],
    ["market-data/historical/candles", ["symbol"]],
    ["market-data/historical/stats", ["symbol"]],
    ["market-data/snapshot/quotes", ["market"]],
    ["market-data/snapshot/movers", ["market"]],
    ["market-data/snapshot/actives", ["market"]],
    ["market-data/technical/bb", ["symbol"]],
    ["market-data/technical/kdj", ["symbol"]],
    ["market-data/technical/macd", ["symbol"]],
    ["market-data/technical/rsi", ["symbol"]],
    ["market-data/technical/sma", ["symbol"]],
    ["market-data-future/intraday/quote", ["symbol"]],
    ["market-data-future/intraday/candles", ["symbol"]],
    ["market-data-future/intraday/trades", ["symbol"]],
    ["market-data-future/intraday/volumes", ["symbol"]],
  ]);

const endpointEntries: EndpointEntry[] = [
  marketData("market-data", "marketDataStock", "intraday", "tickers"),
  marketData("market-data", "marketDataStock", "intraday", "ticker"),
  marketData("market-data", "marketDataStock", "intraday", "quote"),
  marketData("market-data", "marketDataStock", "intraday", "candles"),
  marketData("market-data", "marketDataStock", "intraday", "trades"),
  marketData("market-data", "marketDataStock", "intraday", "volumes"),
  marketData("market-data", "marketDataStock", "historical", "candles"),
  marketData("market-data", "marketDataStock", "historical", "stats"),
  marketData("market-data", "marketDataStock", "snapshot", "quotes"),
  marketData("market-data", "marketDataStock", "snapshot", "movers"),
  marketData("market-data", "marketDataStock", "snapshot", "actives"),
  marketData("market-data", "marketDataStock", "technical", "sma"),
  marketData("market-data", "marketDataStock", "technical", "rsi"),
  marketData("market-data", "marketDataStock", "technical", "kdj"),
  marketData("market-data", "marketDataStock", "technical", "macd"),
  marketData("market-data", "marketDataStock", "technical", "bb", "bb"),
  marketData("market-data", "marketDataStock", "corporate-actions", "capital-changes", "capitalChanges"),
  marketData("market-data", "marketDataStock", "corporate-actions", "dividends"),
  marketData("market-data", "marketDataStock", "corporate-actions", "listing-applicants", "listingApplicants"),

  marketData("market-data-future", "marketDataFutopt", "intraday", "products"),
  marketData("market-data-future", "marketDataFutopt", "intraday", "tickers"),
  marketData("market-data-future", "marketDataFutopt", "intraday", "ticker"),
  marketData("market-data-future", "marketDataFutopt", "intraday", "quote"),
  marketData("market-data-future", "marketDataFutopt", "intraday", "candles"),
  marketData("market-data-future", "marketDataFutopt", "intraday", "trades"),
  marketData("market-data-future", "marketDataFutopt", "intraday", "volumes"),

  ordered("trading/account-management/bank-remain", QUERY, "accounting", ["bankRemain"], ["account"]),
  ordered("trading/account-management/inventories", QUERY, "accounting", ["inventories"], ["account"]),
  ordered("trading/account-management/maintenance", QUERY, "accounting", ["maintenance"], ["account"]),
  ordered("trading/account-management/query-settlement", QUERY, "accounting", ["querySettlement"], ["account", "range"]),
  ordered("trading/account-management/realized-gains-and-loses", QUERY, "accounting", ["realizedGainsAndLoses"], ["account"]),
  ordered("trading/account-management/realized-gains-and-loses-summary", QUERY, "accounting", ["realizedGainsAndLosesSummary"], ["account"]),
  ordered("trading/account-management/unrealized-gains-and-loses", QUERY, "accounting", ["unrealizedGainsAndLoses"], ["account"]),

  ordered("trading/trade/place-order", MUTATION, "stock", ["placeOrder"], ["account", "order"], ["unblock"]),
  ordered("trading/trade/get-order-results", QUERY, "stock", ["getOrderResults"], ["account"]),
  ordered("trading/trade/get-order-results-detail", QUERY, "stock", ["getOrderResultsDetail"], ["account"]),
  ordered("trading/trade/make-modify-price-obj", QUERY, "stock", ["makeModifyPriceObj"], ["order"], ["price", "priceType"]),
  ordered("trading/trade/modify-price", MUTATION, "stock", ["modifyPrice"], ["account", "orderRes"], ["unblock"]),
  ordered("trading/trade/make-modify-quantity-obj", QUERY, "stock", ["makeModifyQuantityObj"], ["order", "quantity"]),
  ordered("trading/trade/modify-quantity", MUTATION, "stock", ["modifyQuantity"], ["account", "orderRes"], ["unblock"]),
  ordered("trading/trade/cancel-order", MUTATION, "stock", ["cancelOrder"], ["account", "orderRes"], ["unblock"]),
  ordered("trading/trade/order-history", QUERY, "stock", ["orderHistory"], ["account", "startDate"], ["endDate"]),
  ordered("trading/trade/filled-history", QUERY, "stock", ["filledHistory"], ["account"], ["startDate", "endDate"]),
  ordered("trading/trade/margin-quota", QUERY, "stock", ["marginQuota"], ["account", "symbol"]),
  ordered("trading/trade/daytrade-and-stock-info", QUERY, "stock", ["daytradeAndStockInfo"], ["account", "symbol"]),
  ordered("trading/trade/query-symbol-quote", QUERY, "stock", ["querySymbolQuote"], ["account", "symbol"], ["marketType"]),
  ordered("trading/trade/query-symbol-snapshot", QUERY, "stock", ["querySymbolSnapshot"], ["account"], ["marketType", "stockTypes"]),
  ordered("trading/trade/batch-order/batch-place-order", MUTATION, "stock", ["batchPlaceOrder"], ["account", "orders"]),
  ordered("trading/trade/batch-order/batch-modify-quantity", MUTATION, "stock", ["batchModifyQuantity"], ["account", "orders"]),
  ordered("trading/trade/batch-order/batch-modify-price", MUTATION, "stock", ["batchModifyPrice"], ["account", "orders"]),
  ordered("trading/trade/batch-order/batch-cancel-order", MUTATION, "stock", ["batchCancelOrder"], ["account", "orders"]),
  ordered("trading/trade/batch-order/batch-order-list", QUERY, "stock", ["batchOrderLists"], ["account"]),
  ordered("trading/trade/batch-order/batch-order-detail", QUERY, "stock", ["batchOrderDetail"], ["account", "batch"]),

  ordered("trading-future/account-management/close-position-record", QUERY, "futoptAccounting", ["closePositionRecord"], ["account", "startDate"], ["endDate"]),
  ordered("trading-future/account-management/query-hybrid-position", QUERY, "futoptAccounting", ["queryHybridPosition"], ["account"]),
  ordered("trading-future/account-management/query-margin-equity", QUERY, "futoptAccounting", ["queryMarginEquity"], ["account"]),
  ordered("trading-future/account-management/query-single-position", QUERY, "futoptAccounting", ["querySinglePosition"], ["account"]),

  ordered("trading-future/trade/place-order", MUTATION, "futopt", ["placeOrder"], ["account", "order"], ["unblock"]),
  ordered("trading-future/trade/get-order-results", QUERY, "futopt", ["getOrderResults"], ["account"], ["marketType"]),
  ordered("trading-future/trade/get-order-results-detail", QUERY, "futopt", ["getOrderResultsDetail"], ["account"], ["marketType"]),
  ordered("trading-future/trade/make-modify-price-obj", QUERY, "futopt", ["makeModifyPriceObj"], ["order"], ["price", "priceType"]),
  ordered("trading-future/trade/modify-price", MUTATION, "futopt", ["modifyPrice"], ["account", "orderRes"], ["unblock"]),
  ordered("trading-future/trade/make-modify-lot-obj", QUERY, "futopt", ["makeModifyLotObj"], ["order", "lot"]),
  ordered("trading-future/trade/modify-lot", MUTATION, "futopt", ["modifyLot"], ["account", "orderRes"], ["unblock"]),
  ordered("trading-future/trade/cancel-order", MUTATION, "futopt", ["cancelOrder"], ["account", "orderRes"], ["unblock"]),
  ordered("trading-future/trade/order-history", QUERY, "futopt", ["orderHistory"], ["account", "startDate", "endDate"], ["marketType"]),
  ordered("trading-future/trade/filled-history", QUERY, "futopt", ["filledHistory"], ["account", "marketType", "startDate"], ["endDate"]),
  ordered("trading-future/trade/query-estimate-margin", QUERY, "futopt", ["queryEstimateMargin"], ["account", "order"]),
  ordered("trading-future/trade/convert-symbol", QUERY, "futopt", ["convertSymbol"], ["stockSymbol", "expiryDate"], ["strikePrice", "callPut"]),
  ordered("trading-future/trade/batch-order/batch-place-order", MUTATION, "futopt", ["batchPlaceOrder"], ["account", "orders"]),
  ordered("trading-future/trade/batch-order/batch-modify-quantity", MUTATION, "futopt", ["batchModifyLot"], ["account", "orders"]),
  ordered("trading-future/trade/batch-order/batch-modify-price", MUTATION, "futopt", ["batchModifyPrice"], ["account", "orders"]),
  ordered("trading-future/trade/batch-order/batch-cancel-order", MUTATION, "futopt", ["batchCancelOrder"], ["account", "orders"]),
  ordered("trading-future/trade/batch-order/batch-order-list", QUERY, "futopt", ["batchOrderLists"], ["account"]),
  ordered("trading-future/trade/batch-order/batch-order-detail", QUERY, "futopt", ["batchOrderDetail"], ["account", "batch"]),
];

function smartConditionEndpoints(
  product: "smart-condition" | "smart-condition-future",
  service: "stock" | "futopt",
): EndpointEntry[] {
  const futureOptional = product === "smart-condition-future" ? ["marketType"] : [];

  return [
    ordered(`${product}/single-condition`, MUTATION, service, ["singleCondition"], ["account", "startDate", "endDate", "stopSign", "condition", "order"], ["childInfo"]),
    ordered(`${product}/single-condition-tpsl`, MUTATION, service, ["singleCondition"], ["account", "startDate", "endDate", "stopSign", "condition", "order", "childInfo"]),
    ordered(`${product}/multi-condition`, MUTATION, service, ["multiCondition"], ["account", "startDate", "endDate", "stopSign", "conditions", "order"], ["childInfo"]),
    ordered(`${product}/multi-condition-tpsl`, MUTATION, service, ["multiCondition"], ["account", "startDate", "endDate", "stopSign", "conditions", "order", "childInfo"]),
    ordered(`${product}/trail-profit/trail-order`, MUTATION, service, ["trailProfit"], ["account", "startDate", "endDate", "stopSign", "trailOrder"]),
    ordered(`${product}/trail-profit/get-trail-order`, QUERY, service, ["getTrailOrder"], ["account"], futureOptional),
    ordered(`${product}/trail-profit/get-trail-history`, QUERY, service, ["getTrailHistory"], ["account", "startDate", "endDate"], futureOptional),
    ordered(`${product}/time-slice/time-slice-order`, MUTATION, service, ["timeSliceOrder"], ["account", "startDate", "endDate", "stopSign", "splitDescription", "order"]),
    ordered(`${product}/time-slice/get-time-slice-order`, QUERY, service, ["getTimeSliceOrder"], ["account", "batchNo"], futureOptional),
    ordered(`${product}/get-condition-history`, QUERY, service, ["getConditionHistory"], ["account", "startDate", "endDate"], product === "smart-condition-future" ? ["marketType", "historyType"] : ["historyType"]),
    ordered(`${product}/get-condition-order`, QUERY, service, ["getConditionOrder"], ["account"], product === "smart-condition-future" ? ["marketType", "conditionStatus"] : ["conditionStatus"]),
    ordered(`${product}/get-condition-by-id`, QUERY, service, ["getConditionOrderById"], ["account", "guid"], futureOptional),
    ordered(`${product}/cancel-condition`, MUTATION, service, ["cancelConditionOrders"], ["account", "guid"], futureOptional),
  ];
}

endpointEntries.push(
  ...smartConditionEndpoints("smart-condition", "stock"),
  ...smartConditionEndpoints("smart-condition-future", "futopt"),
  ordered("smart-condition/day-trade/get-condition-daytrade-by-id", QUERY, "stock", ["getConditionDaytradeById"], ["account", "guid"]),
  ordered("smart-condition/day-trade/single-condition-day-trade", MUTATION, "stock", ["singleConditionDayTrade"], ["account", "stopSign", "endTime", "condition", "order", "dayTrade"], ["childInfo", "fixSession"]),
  ordered("smart-condition/day-trade/multi-condition-day-trade", MUTATION, "stock", ["multiConditionDayTrade"], ["account", "stopSign", "endTime", "conditions", "order", "dayTrade"], ["childInfo", "fixSession"]),
);

export const FUBON_PROXY_ENDPOINTS: ReadonlyMap<string, FubonProxyEndpoint> =
  new Map(endpointEntries);

export interface MatchedFubonProxyEndpoint {
  endpoint: FubonProxyEndpoint;
  pathParameters: Record<string, string>;
}

export function matchFubonProxyEndpoint(
  pathname: string,
): MatchedFubonProxyEndpoint | undefined {
  const exactEndpoint = FUBON_PROXY_ENDPOINTS.get(pathname);
  if (exactEndpoint) {
    return { endpoint: exactEndpoint, pathParameters: {} };
  }

  const pathnameSegments = pathname.split("/").filter(Boolean);

  for (const [basePath, endpoint] of FUBON_PROXY_ENDPOINTS) {
    if (!endpoint.pathParameterNames) {
      continue;
    }

    const basePathSegments = basePath.split("/").filter(Boolean);
    if (
      pathnameSegments.length !==
        basePathSegments.length + endpoint.pathParameterNames.length ||
      !basePathSegments.every(
        (segment, index) => pathnameSegments[index] === segment,
      )
    ) {
      continue;
    }

    const pathParameters = Object.fromEntries(
      endpoint.pathParameterNames.map((name, index) => [
        name,
        decodeURIComponent(pathnameSegments[basePathSegments.length + index] ?? ""),
      ]),
    );
    return { endpoint, pathParameters };
  }

  return undefined;
}
