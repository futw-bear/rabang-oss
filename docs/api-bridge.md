# Shioaji HTTP API Bridge

## Overview

The bridge exposes the Shioaji 1.5 HTTP and SSE surface below `/bridge` and
executes supported operations through Fubon Neo.

```text
Shioaji: POST /api/v1/portfolio/account_balance
Bridge:  POST /bridge/api/v1/portfolio/account_balance
```

The bridge registers all 55 documented fixed Shioaji API endpoints, dynamic
contract/watchlist/app paths, app-file serving, and an OpenAPI endpoint at
`GET /bridge/openapi.json`.

Every route has one of these outcomes:

- A Shioaji request is validated, converted to one or more Fubon calls, and
  returned in a Shioaji response shape.
- A server-local Shioaji feature is implemented by the bridge.
- A documented inability to preserve the operation returns HTTP `501` using
  the Shioaji error shape `{ "code", "message", "details" }`.

The existing `/proxy` API remains unchanged and continues to expose raw Fubon
concepts. Raw Fubon responses are never returned from `/bridge`.

## Implemented endpoint groups

### Health and authentication

| Endpoints                                        | Implementation                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `health`, `info`                                 | Bridge and Fubon gateway state. Fields unavailable from Fubon are `null`.      |
| `auth/accounts`                                  | Maps Fubon `branchNo`, `account`, and `accountType` to Shioaji account fields. |
| `auth/subscribe_trade`, `auth/unsubscribe_trade` | Tracks account subscriptions for order-event SSE.                              |
| `auth/usage`, `auth/ca_expiretime`               | HTTP `501`; Fubon exposes no equivalent query.                                 |

Fubon login data has no safe `person_id` account selector. A non-null
`person_id` therefore returns `501` instead of silently selecting another
account.

### Market data

| Endpoint                                          | Implementation                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `data/snapshots`                                  | Calls Fubon stock or futures intraday quote per contract and maps snapshot fields.                                |
| `data/ticks`                                      | Maps current-session Fubon trades into Shioaji column arrays. Historical dates return `501`.                      |
| `data/kbars`                                      | Maps Fubon stock candles into Shioaji column arrays. Futures historical ranges return `501`.                      |
| `data/scanner`                                    | Maps Fubon TSE/OTC movers and actives for supported rank types. `TickCountRank` returns `501`.                    |
| `data/contracts`, `data/contracts/{code}`         | Supports stock metadata and pagination. Derivative metadata returns `501` because the schemas are not equivalent. |
| `data/daily_quotes`                               | HTTP `501`; Fubon requires a symbol and cannot reproduce the market-wide query.                                   |
| `data/credit_enquire`, `data/short_stock_sources` | Maps per-symbol Fubon margin/short quota, available units, ratios, and bridge query time.                         |
| Regulatory endpoints                              | HTTP `501`; no equivalent Fubon dataset exists.                                                                   |

Fubon epoch timestamps are converted to Asia/Taipei wall-clock strings. They
are not treated as UTC Shioaji market times.

### Regular orders

| Endpoint                                     | Implementation                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `order/place_order`                          | Converts stock, futures, and options request enums, units, account selectors, and nested Trade responses. |
| `order/trades`                               | Converts Fubon stock/futures order results into Shioaji nested Trade objects.                             |
| `order/order_deal_records`                   | Converts reconciled Fubon order results into Shioaji order-event records.                                 |
| `cancel_order`, `update_price`, `update_qty` | HTTP `501` until a stable trade-ID correlation store is implemented.                                      |
| Combo-order endpoints                        | HTTP `501`; no equivalent Fubon combo workflow exists.                                                    |
| Reserve and earmarking endpoints             | HTTP `501`; no equivalent Fubon workflow exists.                                                          |

Order conversion rejects unknown enum values and invalid TAIFEX combinations
before invoking Fubon. A stock `Common` quantity is converted from Shioaji lots
to Fubon shares. Odd-lot quantities remain shares.

Production requests execute real broker operations. Tests use connector stubs
and do not submit orders.

### Portfolio

| Endpoint                                        | Implementation                                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `portfolio/account_balance`                     | Maps `availableBalance` to `acc_balance`; the bridge supplies query-completion time because Fubon omits it. |
| `portfolio/margin`                              | Maps Fubon futures margin-equity fields to Shioaji `Margin`. Unsupported source fields are zero.            |
| `portfolio/position_unit`                       | Maps stock unrealized P&L and futures positions, including Common/Share stock units.                        |
| `portfolio/settlements`, `portfolio/settlement` | Maps Fubon three-day settlement data to current and legacy Shioaji shapes.                                  |
| `portfolio/profit_loss`                         | Maps stock realized P&L and applies requested date filtering. Futures returns `501`.                        |
| `portfolio/profitloss_sum`                      | Maps stock realized summary and total P&L. Futures returns `501`.                                           |
| `position_detail`, `profit_loss_detail`         | HTTP `501`; Shioaji detail IDs have no stable Fubon equivalent.                                             |
| `trading_limits`                                | HTTP `501`; Fubon maintenance ratio is not equivalent to Shioaji trading limits.                            |

### SSE

The bridge implements the Shioaji subscribe/connect/unsubscribe workflow:

1. `POST /bridge/api/v1/stream/subscribe`
2. `GET /bridge/api/v1/stream/data` or an individual stream
3. `POST /bridge/api/v1/stream/unsubscribe`

Implemented streams:

- `tick_stk`, `bidask_stk`, `quote_stk`
- `tick_fop`, `bidask_fop`, `quote_fop`
- `order_event`
- combined `/stream/data`

The gateway supports separate shared Fubon stock and futures WebSockets. The
bridge fans each upstream stream out to all matching SSE clients rather than
opening one broker WebSocket per client. SSE sends a heartbeat every 30 seconds
and cleans up client state on abort.

Fubon subscription acknowledgement supplies the ID required for unsubscribe.
An unsubscribe attempted before that acknowledgement returns HTTP `409`.

Fubon order, changed-order, and fill callbacks are forwarded through the
gateway protocol and converted to Shioaji `StockOrder`, `StockDeal`,
`FuturesOrder`, or `FuturesDeal` events.

### Watchlists and apps

All watchlist CRUD, sync, add-contract, and remove-contract endpoints are
implemented with bridge-local in-memory state.

All app list/upload/delete endpoints and `/bridge/apps/{app}/{file}` serving are
implemented in memory. Uploads require `Content-Length`, multipart field
`files`, safe path segments, and a maximum total request size of 50 MB.

Watchlists and apps intentionally reset when the process restarts. Persistent
storage can be added without changing their HTTP contract.

## Architecture

```text
Shioaji HTTP/SSE client
          |
          v
  /bridge dispatcher
          |
          +-- account and request validation
          +-- market-data adapters
          +-- regular-order adapters
          +-- portfolio adapters
          +-- shared SSE subscription manager
          +-- local watchlist/app store
          |
          v
 FubonConnector -> fubon-gateway process -> Fubon Neo SDK
```

The gateway process owns Fubon SDK objects and callback registration. JSON-safe
gateway events cross the process boundary; HTTP and SSE conversion remains in
the main server process.

## Contract verification

The implementation is based on the bundled offline references:

- `.agents/skills/fubon-neo-api/references/docs/trading/library/nodejs`
- `.agents/skills/fubon-neo-api/references/docs/trading-future/library/nodejs`
- `.agents/skills/fubon-neo-api/references/docs/market-data`
- `.agents/skills/shioaji-api/references/docs/zh/tutor`
- Shioaji plugin `HTTP_API.md`, `ACCOUNTING.md`, `MARKET_DATA.md`, `ORDERS.md`,
  `STREAMING.md`, `WATCHLIST.md`, and `CONCEPTS.md`

The Shioaji HTTP schema can change between installed versions. Before calling
the bridge byte-for-byte compatible with a particular release, archive that
server's `/openapi.json` and run the same contract fixtures against both
servers. The bridge-generated OpenAPI currently describes route and method
availability; it does not replace the pinned Shioaji component schemas.
