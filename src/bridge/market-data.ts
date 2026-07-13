import {
  arrayField,
  asNumber,
  asString,
  assertAllowedFields,
  BridgeHttpError,
  type BridgeConnector,
  formatShioajiDate,
  formatTimestamp,
  objectField,
  readJsonObject,
  record,
  records,
  stringField,
  unwrapFubon,
  unsupported,
} from "./common.ts";

interface ContractRequest {
  security_type: string;
  exchange: string;
  code: string;
  target_code?: string | null;
}

export async function handleMarketData(
  connector: BridgeConnector,
  path: string,
  request: Request,
  now: () => Date = () => new Date(),
): Promise<Response> {
  switch (path) {
    case "/api/v1/data/snapshots":
      return snapshots(connector, await readJsonObject(request));
    case "/api/v1/data/ticks":
      return ticks(connector, await readJsonObject(request));
    case "/api/v1/data/kbars":
      return kbars(connector, await readJsonObject(request));
    case "/api/v1/data/scanner":
      return scanner(connector, await readJsonObject(request));
    case "/api/v1/data/contracts":
      return contracts(connector, await readJsonObject(request));
    case "/api/v1/data/daily_quotes":
      unsupported(
        path,
        "Fubon requires a symbol and cannot reproduce Shioaji market-wide daily quotes",
      );
    case "/api/v1/data/credit_enquire":
      return creditEnquire(connector, await readJsonObject(request), now);
    case "/api/v1/data/short_stock_sources":
      return shortStockSources(connector, await readJsonObject(request), now);
    case "/api/v1/data/regulatory_punish":
    case "/api/v1/data/regulatory_notice":
      unsupported(path, "No equivalent Fubon regulatory dataset is available");
    default:
      if (path.startsWith("/api/v1/data/contracts/")) {
        return contract(connector, path, request);
      }
      unsupported(path);
  }
}

async function creditEnquire(
  connector: BridgeConnector,
  body: Record<string, unknown>,
  now: () => Date,
): Promise<Response> {
  const { contracts, values } = await marginQuotaForContracts(connector, body);
  const queriedAt = formatShioajiDate(now());
  return Response.json(
    values.map((item, index) => ({
      update_time: queriedAt,
      system: "ALL",
      stock_id: contracts[index]?.code ?? asString(item.stockNo),
      margin_unit: asNumber(item.marginTradableQuota ?? item.marginOrigQuota),
      short_unit: asNumber(
        item.shortsellTradableQuota ?? item.shortsellOrigQuota,
      ),
      margin_loan_ratio: asNumber(item.marginRatio),
      short_margin_ratio: asNumber(item.shortRatio),
    })),
  );
}

async function shortStockSources(
  connector: BridgeConnector,
  body: Record<string, unknown>,
  now: () => Date,
): Promise<Response> {
  const { contracts, values } = await marginQuotaForContracts(connector, body);
  const datetime = formatShioajiDate(now()).replace(" ", "T").slice(0, 26);
  return Response.json(
    values.map((item, index) => ({
      code: contracts[index]?.code ?? asString(item.stockNo),
      short_stock_source: asNumber(
        item.shortsellTradableQuota ?? item.shortsellOrigQuota,
      ),
      datetime,
    })),
  );
}

async function marginQuotaForContracts(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<{
  contracts: ContractRequest[];
  values: Record<string, unknown>[];
}> {
  assertAllowedFields(body, ["contracts"]);
  const contracts = arrayField(body, "contracts").map(parseContract);
  if (contracts.some((contract) => contract.security_type !== "STK")) {
    throw new BridgeHttpError(400, "Only stock contracts are supported");
  }
  const account = connector.accounts.find(
    (candidate) => candidate.accountType === "stock",
  );
  if (!account) throw new BridgeHttpError(400, "Stock account is unavailable");
  const values = await Promise.all(
    contracts.map(async (contract) => {
      const raw = unwrapFubon(
        await connector.invokeProxy({
          target: { service: "stock", methodPath: ["marginQuota"] },
          arguments: [account, contract.code],
        }),
        "marginQuota",
      );
      if (Array.isArray(raw)) return raw.length > 0 ? record(raw[0]) : {};
      return record(raw);
    }),
  );
  return { contracts, values };
}

async function snapshots(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, ["contracts"]);
  const contracts = arrayField(body, "contracts").map(parseContract);
  if (contracts.length > 500)
    throw new BridgeHttpError(400, "contracts must contain at most 500 items");
  const values = await Promise.all(
    contracts.map(async (contract) => {
      const service =
        contract.security_type === "STK"
          ? "marketDataStock"
          : "marketDataFutopt";
      const raw = record(
        await connector.invokeProxy({
          target: { service, methodPath: ["intraday", "quote"] },
          arguments: [{ symbol: contract.target_code || contract.code }],
        }),
      );
      return mapSnapshot(raw, contract.exchange);
    }),
  );
  return Response.json(values);
}

function mapSnapshot(item: Record<string, unknown>, requestedExchange: string) {
  const bids = Array.isArray(item.bids) ? item.bids.map(record) : [];
  const asks = Array.isArray(item.asks) ? item.asks.map(record) : [];
  const total =
    typeof item.total === "object" && item.total !== null
      ? record(item.total)
      : {};
  const close = asNumber(item.closePrice ?? item.lastPrice);
  return {
    datetime: formatTimestamp(item.lastUpdated ?? item.closeTime),
    code: asString(item.symbol),
    exchange: mapExchange(asString(item.exchange), requestedExchange),
    open: asNumber(item.openPrice),
    high: asNumber(item.highPrice),
    low: asNumber(item.lowPrice),
    close,
    tick_type: "No",
    change_price: asNumber(item.change),
    change_rate: asNumber(item.changePercent),
    change_type: mapChangeType(asNumber(item.change), item),
    average_price: asNumber(item.avgPrice),
    volume: asNumber(item.lastSize),
    total_volume: asNumber(total.tradeVolume),
    amount: asNumber(item.lastSize) * close,
    total_amount: asNumber(total.tradeValue),
    yesterday_volume: 0,
    buy_price: asNumber(bids[0]?.price),
    buy_volume: asNumber(bids[0]?.size),
    sell_price: asNumber(asks[0]?.price),
    sell_volume: asNumber(asks[0]?.size),
    volume_ratio: 0,
  };
}

async function ticks(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, [
    "contract",
    "date",
    "query_type",
    "time_start",
    "time_end",
    "last_cnt",
  ]);
  const contract = parseContract(objectField(body, "contract", true)!);
  const date = stringField(body, "date", true)!;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(new Date());
  if (date !== today) {
    unsupported(
      "/api/v1/data/ticks",
      "Fubon only provides intraday trade ticks for the current session",
    );
  }
  const queryType = stringField(body, "query_type") ?? "AllDay";
  const lastCount =
    body.last_cnt === undefined ? undefined : asNumber(body.last_cnt);
  const service =
    contract.security_type === "STK" ? "marketDataStock" : "marketDataFutopt";
  const params: Record<string, unknown> = {
    symbol: contract.target_code || contract.code,
  };
  if (queryType === "LastCount") params.limit = lastCount ?? 100;
  const raw = record(
    await connector.invokeProxy({
      target: { service, methodPath: ["intraday", "trades"] },
      arguments: [params],
    }),
  );
  let data = records(raw.data ?? []);
  if (body.time_start || body.time_end) {
    data = data.filter((item) => {
      const time = formatTimestamp(item.time).slice(11, 19);
      return (
        (!body.time_start || time >= body.time_start) &&
        (!body.time_end || time <= body.time_end)
      );
    });
  }
  if (queryType === "LastCount" && lastCount !== undefined)
    data = data.slice(-lastCount);
  return Response.json({
    datetime: data.map((item) => formatTimestamp(item.time)),
    close: data.map((item) => asNumber(item.price)),
    volume: data.map((item) => asNumber(item.size)),
    bid_price: data.map((item) => asNumber(item.bid)),
    bid_volume: data.map(() => 0),
    ask_price: data.map((item) => asNumber(item.ask)),
    ask_volume: data.map(() => 0),
    tick_type: data.map((item) => {
      const price = asNumber(item.price);
      if (price >= asNumber(item.ask)) return 1;
      if (price <= asNumber(item.bid)) return 2;
      return 0;
    }),
  });
}

async function kbars(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, ["contract", "start", "end"]);
  const contract = parseContract(objectField(body, "contract", true)!);
  const start = stringField(body, "start", true)!;
  const end = stringField(body, "end", true)!;
  if (contract.security_type !== "STK") {
    unsupported(
      "/api/v1/data/kbars",
      "Fubon futures REST API has no historical date-range candle endpoint",
    );
  }
  const raw = record(
    await connector.invokeProxy({
      target: {
        service: "marketDataStock",
        methodPath: ["historical", "candles"],
      },
      arguments: [
        {
          symbol: contract.code,
          from: start,
          to: end,
          timeframe: "1",
          sort: "asc",
        },
      ],
    }),
  );
  const data = records(raw.data ?? []);
  return Response.json({
    datetime: data.map((item) => candleDatetime(item)),
    Open: data.map((item) => asNumber(item.open)),
    High: data.map((item) => asNumber(item.high)),
    Low: data.map((item) => asNumber(item.low)),
    Close: data.map((item) => asNumber(item.close)),
    Volume: data.map((item) => asNumber(item.volume)),
    Amount: data.map((item) => asNumber(item.turnover)),
  });
}

async function scanner(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, ["scanner_type", "date", "ascending", "count"]);
  const type = stringField(body, "scanner_type", true)!;
  const ascending = body.ascending === true;
  const count = Math.max(1, Math.min(200, asNumber(body.count, 200)));
  const mover = [
    "ChangePercentRank",
    "ChangePriceRank",
    "DayRangeRank",
  ].includes(type);
  if (!mover && !["VolumeRank", "AmountRank"].includes(type)) {
    unsupported(
      "/api/v1/data/scanner",
      `Fubon cannot reproduce scanner type ${type}`,
    );
  }
  const results = await Promise.all(
    ["TSE", "OTC"].map((market) =>
      connector.invokeProxy({
        target: {
          service: "marketDataStock",
          methodPath: ["snapshot", mover ? "movers" : "actives"],
        },
        arguments: [
          mover
            ? {
                market,
                direction: ascending ? "down" : "up",
                change: type === "ChangePriceRank" ? "value" : "percent",
              }
            : { market, trade: type === "AmountRank" ? "value" : "volume" },
        ],
      }),
    ),
  );
  const data = results.flatMap((raw) => records(record(raw).data ?? []));
  data.sort(
    (left, right) => scannerValue(right, type) - scannerValue(left, type),
  );
  if (ascending) data.reverse();
  return Response.json(data.slice(0, count).map(mapScanner));
}

async function contracts(
  connector: BridgeConnector,
  body: Record<string, unknown>,
): Promise<Response> {
  assertAllowedFields(body, ["security_type", "page", "page_size"]);
  const securityType = stringField(body, "security_type", true)!;
  const page = asNumber(body.page, 1);
  const pageSize = Math.max(1, asNumber(body.page_size, 1000));
  if (securityType !== "STK") {
    unsupported(
      "/api/v1/data/contracts",
      "Fubon derivatives product metadata cannot preserve the Shioaji contract schema",
    );
  }
  const responses = await Promise.all(
    ["TWSE", "TPEx"].map((exchange) =>
      connector.invokeProxy({
        target: {
          service: "marketDataStock",
          methodPath: ["intraday", "tickers"],
        },
        arguments: [{ type: "EQUITY", exchange }],
      }),
    ),
  );
  const all = responses.flatMap((raw, index) =>
    records(record(raw).data ?? []).map((item) => ({
      security_type: "STK",
      exchange: index === 0 ? "TSE" : "OTC",
      code: asString(item.symbol),
      symbol: asString(item.symbol),
      name: asString(item.name),
      target_code: null,
    })),
  );
  const effectivePage = page === -1 ? 1 : Math.max(1, page);
  const effectiveSize = page === -1 ? Math.max(all.length, 1) : pageSize;
  const offset = (effectivePage - 1) * effectiveSize;
  return Response.json({
    contracts: all.slice(offset, offset + effectiveSize),
    page,
    page_size: effectiveSize,
    max_page: Math.max(1, Math.ceil(all.length / effectiveSize)),
    total: all.length,
  });
}

async function contract(
  connector: BridgeConnector,
  path: string,
  request: Request,
): Promise<Response> {
  const code = decodeURIComponent(path.slice("/api/v1/data/contracts/".length));
  const securityType = new URL(request.url).searchParams.get("security_type");
  if (!securityType)
    throw new BridgeHttpError(400, "security_type is required");
  if (securityType !== "STK") {
    unsupported(
      path,
      "Fubon derivatives metadata cannot preserve the Shioaji contract schema",
    );
  }
  const raw = record(
    await connector.invokeProxy({
      target: {
        service: "marketDataStock",
        methodPath: ["intraday", "ticker"],
      },
      arguments: [{ symbol: code }],
    }),
  );
  return Response.json({
    security_type: "STK",
    exchange: mapExchange(asString(raw.exchange), asString(raw.market)),
    code: asString(raw.symbol, code),
    symbol: asString(raw.symbol, code),
    name: asString(raw.name),
    category: asString(raw.securityType),
    unit: asNumber(raw.boardLot, 1000),
    limit_up: asNumber(raw.limitUpPrice),
    limit_down: asNumber(raw.limitDownPrice),
    reference: asNumber(raw.referencePrice),
    update_date: asString(raw.date),
    day_trade: raw.canDayTrade === true ? "Yes" : "No",
    target_code: null,
  });
}

function parseContract(value: unknown): ContractRequest {
  const item = record(value);
  const securityType = stringField(item, "security_type", true)!;
  if (!["STK", "FUT", "OPT", "IND"].includes(securityType)) {
    throw new BridgeHttpError(400, "contract.security_type is invalid");
  }
  return {
    security_type: securityType,
    exchange: stringField(item, "exchange", true)!,
    code: stringField(item, "code", true)!,
    target_code:
      item.target_code === null ? null : stringField(item, "target_code"),
  };
}

function mapExchange(value: string, fallback: string): string {
  if (value === "TWSE") return "TSE";
  if (value === "TPEx") return "OTC";
  if (value === "TAIFEX") return "TAIFEX";
  return fallback;
}

function mapChangeType(change: number, item: Record<string, unknown>): string {
  if (item.isLimitUpPrice === true) return "LimitUp";
  if (item.isLimitDownPrice === true) return "LimitDown";
  if (change > 0) return "Up";
  if (change < 0) return "Down";
  return "Unchanged";
}

function candleDatetime(item: Record<string, unknown>): string {
  if (item.time !== undefined) return formatTimestamp(item.time);
  return `${asString(item.date)}T00:00:00`;
}

function scannerValue(item: Record<string, unknown>, type: string): number {
  if (type === "VolumeRank") return asNumber(item.tradeVolume);
  if (type === "AmountRank") return asNumber(item.tradeValue);
  if (type === "ChangePriceRank") return asNumber(item.change);
  if (type === "DayRangeRank")
    return asNumber(item.highPrice) - asNumber(item.lowPrice);
  return asNumber(item.changePercent);
}

function mapScanner(item: Record<string, unknown>): Record<string, unknown> {
  return {
    code: asString(item.symbol),
    name: asString(item.name),
    ts: asNumber(item.lastUpdated),
    open: asNumber(item.openPrice),
    high: asNumber(item.highPrice),
    low: asNumber(item.lowPrice),
    close: asNumber(item.closePrice),
    change_price: asNumber(item.change),
    change_rate: asNumber(item.changePercent),
    total_volume: asNumber(item.tradeVolume),
    amount: asNumber(item.tradeValue),
  };
}
