# Shioaji HTTP API Bridge

## Goal

The bridge exposes Shioaji-compatible HTTP and SSE paths below `/bridge` while
executing supported operations through the existing Fubon gateway.

For example:

```text
Shioaji: POST /api/v1/portfolio/account_balance
Bridge:  POST /bridge/api/v1/portfolio/account_balance
```

Compatibility means preserving the Shioaji HTTP method, request JSON, response
JSON, SSE event names, and error JSON. It does not mean forwarding a request to
a running Shioaji server.

The bridge must not invent financially meaningful values when Fubon has no
equivalent source field. Such endpoints stay unavailable until a documented
mapping exists.

## Architecture

```text
Shioaji client
    |
    | HTTP JSON or SSE under /bridge/api/v1
    v
Bridge router
    |
    +-- request validation and account resolution
    +-- Shioaji-to-Fubon enum and unit conversion
    +-- state store for trade IDs, subscriptions, watchlists, and apps
    +-- Fubon-to-Shioaji response and event conversion
    |
    v
FubonConnector -> fubon-gateway process -> Fubon Neo SDK
```

Each endpoint adapter has four separate responsibilities:

1. Validate the Shioaji request without accepting Fubon-only fields.
2. Resolve `account_type`, `broker_id`, and `account_id` to an authenticated
   Fubon account.
3. Invoke one or more Fubon operations and retain correlation state when the
   Shioaji API later refers to a trade by ID.
4. Produce only the documented Shioaji response or error shape.

The bridge dispatcher is intentionally separate from the existing `/proxy`
dispatcher. `/proxy` exposes Fubon concepts, while `/bridge` exposes Shioaji
concepts and must never leak a raw Fubon result.

## Implemented slice

`POST /bridge/api/v1/portfolio/account_balance` is implemented as the first
vertical slice.

- It accepts the Shioaji `AccountRequest` fields `account_type`, `broker_id`,
  `account_id`, and `person_id`. A non-null `person_id` is rejected because the
  Fubon login account list has no safe field with which to resolve it.
- It resolves the stock account and calls Fubon `accounting.bankRemain`.
- It maps Fubon `availableBalance` to Shioaji `acc_balance`.
- It returns Shioaji error JSON: `{ "code", "message", "details" }`.
- Fubon does not return the query timestamp required by Shioaji. The adapter
  records the bridge query completion time in Asia/Taipei. This is a documented
  semantic approximation, not a broker-sourced timestamp.

All other `/bridge/api/v1/*` paths currently return an explicit `501` in the
Shioaji error JSON shape. This prevents a caller from mistaking an unverified
translation for a compatible implementation.

## Capability matrix

The status values are:

- `Mappable`: Fubon provides the underlying operation; schema conversion is
  still required.
- `Stateful`: mappable only after the bridge owns correlation or subscription
  state.
- `Partial`: some Shioaji fields or semantics have no direct Fubon source.
- `Local`: a Shioaji server feature that can be implemented without a broker.
- `Unavailable`: no equivalent was found in the bundled Fubon Neo documents.

### Health and authentication

| Shioaji endpoints                                | Status      | Design note                                                                                                                   |
| ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `health`, `info`                                 | Partial     | Connection and environment are available, but Shioaji token, contract count, maintenance, and CA-health fields are not.       |
| `auth/accounts`                                  | Mappable    | Map `branchNo/account/accountType` to `broker_id/account_id/S\|F`; Fubon login data has no Shioaji `person_id` account field. |
| `auth/usage`                                     | Unavailable | Fubon does not expose Shioaji connection and traffic quota statistics.                                                        |
| `auth/ca_expiretime`                             | Unavailable | No equivalent SDK query was found.                                                                                            |
| `auth/subscribe_trade`, `auth/unsubscribe_trade` | Stateful    | Fubon order and fill callbacks exist, but the gateway protocol must expose them and track per-account subscriptions.          |

### Market data

| Shioaji endpoints                                  | Status      | Design note                                                                                               |
| -------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `data/snapshots`                                   | Mappable    | Batch Fubon snapshot quotes and convert decimal/string fields.                                            |
| `data/ticks`                                       | Partial     | Fubon historical trades can supply trades, but date range, row limit, and tick schema differ.             |
| `data/kbars`                                       | Partial     | Fubon historical candles are available; interval, timestamp, and adjustment semantics must be reconciled. |
| `data/daily_quotes`                                | Partial     | Fubon historical stats/candles do not expose the identical Shioaji daily quote schema.                    |
| `data/credit_enquire`                              | Partial     | Fubon margin quota and day-trade information cover only part of the response.                             |
| `data/scanner`                                     | Partial     | Fubon movers and actives cover only some scanner types and ranking fields.                                |
| `data/regulatory_punish`, `data/regulatory_notice` | Unavailable | No equivalent query was found.                                                                            |
| `data/short_stock_sources`                         | Partial     | Fubon quota queries do not provide the complete Shioaji source schema.                                    |
| `data/contracts`, `data/contracts/{code}`          | Partial     | Fubon ticker/product metadata can populate a subset; contract identity and derivatives metadata differ.   |

### Orders

| Shioaji endpoints                                                        | Status      | Design note                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `order/place_order`                                                      | Stateful    | Regular stock/futures/options orders are supported, but all order enums and quantity units need explicit conversion and the returned Fubon order result must be cached behind a bridge trade ID. |
| `order/cancel_order`, `order/update_price`, `order/update_qty`           | Stateful    | Shioaji sends a trade ID; Fubon modification methods require an order-result object from the earlier request.                                                                                    |
| `order/trades`, `order/order_deal_records`                               | Partial     | Fubon order results, details, histories, and fills can be combined, but status values and record IDs differ.                                                                                     |
| `order/place_comboorder`, `order/cancel_comboorder`, `order/combotrades` | Unavailable | No documented Fubon equivalent with Shioaji combo-leg semantics was found.                                                                                                                       |
| Stock reserve and earmarking endpoints                                   | Unavailable | No documented equivalent for Shioaji reserve/earmarking workflows was found.                                                                                                                     |

Order adapters must default to no action when an enum is unknown. They must not
guess whether an order is regular, odd-lot, margin, short, day-trade, futures,
or options. Production-mode order tests require explicit operator approval and
must not use real account data in fixtures.

### Portfolio

| Shioaji endpoints                               | Status               | Design note                                                                                                              |
| ----------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `portfolio/account_balance`                     | Partial, implemented | Available balance maps directly; the query time is generated by the bridge because Fubon omits it.                       |
| `portfolio/margin`                              | Partial              | Fubon futures margin-equity provides many fields, but the complete Shioaji `Margin` schema and calculations differ.      |
| `portfolio/position_unit`                       | Partial              | Fubon inventories and futures positions are available; IDs, units, average price, and P&L fields require reconciliation. |
| `portfolio/position_detail`                     | Unavailable          | Shioaji detail IDs do not exist in Fubon inventory responses. A synthetic cache would be session-local and unstable.     |
| `portfolio/settlements`, `portfolio/settlement` | Partial              | Fubon settlement details can be aggregated, but legacy T/T+1/T+2 and current Shioaji row formats are different.          |
| `portfolio/trading_limits`                      | Partial              | Fubon account maintenance data does not provide every Shioaji limit field with identical meaning.                        |
| `portfolio/profit_loss`                         | Partial              | Fubon realized gains/losses can populate a subset; date filtering and IDs differ.                                        |
| `portfolio/profit_loss_detail`                  | Unavailable          | Shioaji detail IDs have no stable Fubon equivalent.                                                                      |
| `portfolio/profitloss_sum`                      | Partial              | Fubon realized summary is available, but field definitions require per-field verification.                               |

### SSE streaming

| Shioaji endpoints                        | Status            | Design note                                                                                                                  |
| ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `stream/subscribe`, `stream/unsubscribe` | Stateful          | Translate the Shioaji subscription to a shared Fubon WebSocket subscription and reference-count identical subscriptions.     |
| `stream/receivers`, `stream/status`      | Local             | Report bridge-owned subscription and SSE connection state.                                                                   |
| Stock tick/bid-ask/quote SSE             | Stateful          | Fubon stock WebSocket data exists; normalize event payloads and preserve `intraday_odd`.                                     |
| Futures/options tick/bid-ask/quote SSE   | Stateful          | Fubon supports a separate futures WebSocket, but the current gateway only opens stock WebSockets and must be extended first. |
| `stream/data/order_event`                | Stateful, partial | Expose Fubon order/fill callbacks through the gateway and normalize them; broker-specific status differences remain.         |

SSE connections must be long-lived, send a Shioaji `heartbeat` event every 30
seconds, remove listeners when the HTTP client aborts, and avoid opening one
Fubon WebSocket per SSE client. One shared upstream subscription fan-outs to
all matching SSE clients.

### Watchlists and apps

| Shioaji endpoints                  | Status | Design note                                                                                                       |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| All `watchlist` endpoints          | Local  | Implement with a bridge-owned persistent store after contract validation is available.                            |
| All `apps` endpoints and `/apps/*` | Local  | Implement as a sandboxed file store with Shioaji's multipart and 50 MB rules. This is unrelated to Fubon trading. |

## Required implementation phases

1. Finish stateless account and market-data adapters and publish a generated
   `/bridge/openapi.json` contract fixture.
2. Add the trade correlation store, enum conversion matrices, and regular-order
   adapters, verified only against Fubon test mode.
3. Extend the gateway protocol with stock/futures market-data and trade-report
   events, then add the shared SSE subscription manager.
4. Add local watchlist and app stores.
5. Keep unavailable endpoints returning `501`, or version the compatibility
   contract if a deliberately lossy response is accepted.

Before claiming full compatibility, contract tests must run the same request
fixtures against a pinned Shioaji 1.5 HTTP server and the bridge, then compare
HTTP status, headers, JSON types, optional-field behavior, and SSE event frames.

## Documentation sources

The design was checked against the bundled offline references:

- `.agents/skills/fubon-neo-api/references/docs/trading/library/nodejs/accountManagement/Balance.txt`
- `.agents/skills/fubon-neo-api/references/docs/trading/library/nodejs/accountManagement/Inventories.txt`
- `.agents/skills/fubon-neo-api/references/docs/trading/library/nodejs/accountManagement/QuerySettlement.txt`
- `.agents/skills/fubon-neo-api/references/docs/trading-future/library/nodejs/accountManagement/QueryEquity.txt`
- `.agents/skills/fubon-neo-api/references/docs/trading/guide/report_example.txt`
- `.agents/skills/shioaji-api/references/docs/zh/tutor/accounting/account_balance/index.md`
- Shioaji plugin references `HTTP_API.md`, `ACCOUNTING.md`, `ORDERS.md`,
  `MARKET_DATA.md`, `STREAMING.md`, `WATCHLIST.md`, and `CONCEPTS.md`

The exact Shioaji HTTP schema is version-dependent. The final contract suite
must pin and archive the target server's `/openapi.json`; the bundled HTTP
reference explicitly identifies that endpoint as the exact schema source.
