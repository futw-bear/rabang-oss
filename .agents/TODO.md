# Shioaji API Bridge 實作狀態

本文件追蹤 Bridge 所公開的所有 Shioaji 1.5 HTTP 與 SSE endpoint。Shioaji 路由會保留在 `/bridge` 前綴下。

## 狀態說明

| 狀態 | 說明 |
| --- | --- |
| Complete | 路由及其主要 Shioaji 行為已實作。 |
| Partial | 路由可運作，但 Fubon 資料無法精確重現一個或多個 Shioaji 欄位、商品、範圍或語意。 |
| Local-only | 此功能由 Bridge 實作，沒有對應的券商操作。其狀態的持久性或擁有者語意可能與 Shioaji 不同。 |
| Not implemented (501) | 路由已註冊，但因沒有安全或穩定的 Fubon 對應功能而回傳 HTTP 501。 |

## 健康狀態與伺服器資訊

| Method | Shioaji route | Bridge route | Function | Status | Remaining work or limitation |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/health` | `/bridge/api/v1/health` | 回報 API 與工作階段健康狀態。 | Partial | Fubon 未公開 Shioaji token 到期時間、合約數量、維護排程或 CA 健康狀態欄位；這些欄位會回傳 `null`。 |
| GET | `/api/v1/info` | `/bridge/api/v1/info` | 回報伺服器中繼資料、通訊協定與模擬模式。 | Complete | 伺服器名稱與版本識別為 Rabang Bridge，而非 Shioaji daemon。 |
| GET | `/openapi.json` | `/bridge/openapi.json` | 回傳 HTTP 介面的 OpenAPI 文件。 | Partial | 已包含路由與方法，但尚未嵌入固定版本的 Shioaji component schemas；請從版本化的 Shioaji `/openapi.json` fixture 加入合約 schema。 |

## 驗證與帳戶

| Method | Shioaji route | Bridge route | Function | Status | Remaining work or limitation |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/auth/usage` | `/bridge/api/v1/auth/usage` | 回傳連線、流量與配額使用量。 | Not implemented (501) | Fubon 未公開 Shioaji 使用統計模型。 |
| GET | `/api/v1/auth/accounts` | `/bridge/api/v1/auth/accounts` | 列出已驗證的交易帳戶。 | Partial | 已對應 `account_type`、`broker_id`、`account_id`、`signed` 與 `username`；Fubon 登入帳戶未公開安全的 Shioaji `person_id` 欄位。 |
| GET | `/api/v1/auth/ca_expiretime?person_id={person_id}` | `/bridge/api/v1/auth/ca_expiretime?person_id={person_id}` | 查詢 CA 憑證到期時間。 | Not implemented (501) | 沒有記錄任何對應的 Fubon SDK 查詢。 |
| POST | `/api/v1/auth/subscribe_trade` | `/bridge/api/v1/auth/subscribe_trade` | 為帳戶啟用委託／成交事件。 | Complete | Bridge 追蹤選定帳戶並接收 gateway 委託／成交回呼；在模擬模式下，這實際上是 no-op 訂閱，符合 Shioaji 行為。 |
| POST | `/api/v1/auth/unsubscribe_trade` | `/bridge/api/v1/auth/unsubscribe_trade` | 停用帳戶的委託／成交事件。 | Complete | 模擬模式會回傳 HTTP 400，因為不存在正式交易訂閱，符合文件記載的 Shioaji 行為。 |

使用非 null `person_id` 的帳戶 selector 會回傳 HTTP 501，因為無法安全地從已驗證的 Fubon 帳戶清單解析該 selector。

## 市場資料

| Method | Shioaji route | Bridge route | Function | Status | Remaining work or limitation |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/data/snapshots` | `/bridge/api/v1/data/snapshots` | 查詢多個股票、期貨或選擇權合約的快照。 | Partial | 每個合約呼叫一次 Fubon 即時報價；不支援的 Shioaji 快照欄位會回傳中性值，精確合約中繼資料取決於請求。 |
| POST | `/api/v1/data/ticks` | `/bridge/api/v1/data/ticks` | 查詢逐筆成交。 | Partial | Fubon 僅公開當前交易時段的盤中成交；查詢其他日期會回傳 HTTP 501。買／賣量無法取得，因此回傳零。 |
| POST | `/api/v1/data/kbars` | `/bridge/api/v1/data/kbars` | 查詢歷史 OHLCV K 線。 | Partial | 股票 K 線會被轉換；Fubon 沒有對應的期貨／選擇權歷史日期範圍 K 線 API，因此這些請求會回傳 HTTP 501。Fubon 的分鐘 K 線範圍限制同樣適用。 |
| POST | `/api/v1/data/daily_quotes` | `/bridge/api/v1/data/daily_quotes` | 查詢全市場每日報價。 | Not implemented (501) | Fubon 歷史日線需要指定代號，無法重現 Shioaji 以欄為導向的全市場結果。 |
| POST | `/api/v1/data/credit_enquire` | `/bridge/api/v1/data/credit_enquire` | 查詢股票合約的融資融券可用量。 | Partial | 對應 Fubon 每個帳戶的融資／融券額度與比例；這是券商帳戶額度語意，可能不同於 Shioaji 上游的全市場信用餘額。 |
| POST | `/api/v1/data/scanner` | `/bridge/api/v1/data/scanner` | 查詢漲跌、成交量與成交金額排行。 | Partial | 使用 Fubon TSE／OTC 漲跌排行與熱門排行；`TickCountRank` 沒有對應功能，會回傳 HTTP 501。Fubon 未提供的排行欄位會省略。 |
| GET | `/api/v1/data/regulatory_punish` | `/bridge/api/v1/data/regulatory_punish` | 查詢法規處分紀錄。 | Not implemented (501) | 沒有記錄任何對應的 Fubon 資料集。 |
| GET | `/api/v1/data/regulatory_notice` | `/bridge/api/v1/data/regulatory_notice` | 查詢法規公告紀錄。 | Not implemented (501) | 沒有記錄任何對應的 Fubon 資料集。 |
| POST | `/api/v1/data/short_stock_sources` | `/bridge/api/v1/data/short_stock_sources` | 查詢可用的借券來源。 | Partial | 對應 Fubon 可融券交易額度與 Bridge 查詢時間；券商額度語意可能不同於 Shioaji 借券來源庫存。 |
| POST | `/api/v1/data/contracts` | `/bridge/api/v1/data/contracts` | 分頁列出合約。 | Partial | 股票合約由 Fubon TWSE／TPEx ticker 清單建立；期貨、選擇權與指數合約清單會回傳 HTTP 501，因 Fubon 商品 schema 無法保留所有 Shioaji 合約欄位。 |
| GET | `/api/v1/data/contracts/{code}?security_type={type}` | `/bridge/api/v1/data/contracts/{code}?security_type={type}` | 依代號與證券類型解析單一合約。 | Partial | 支援股票合約；期貨、選擇權與指數會回傳 HTTP 501，因目標代號、到期日、履約價與分類語意不等價。 |

## 委託

| Method | Shioaji route | Bridge route | Function | Status | Remaining work or limitation |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/order/place_order` | `/bridge/api/v1/order/place_order` | 下單一般股票、期貨或選擇權委託。 | Partial | 轉換請求列舉值與數量，並回傳巢狀的 Shioaji 形式 `Trade`；部分 Shioaji 狀態時間戳與成交詳細資料為合成值或無法取得。正式模式會送出真正的 Fubon 委託。 |
| POST | `/api/v1/order/cancel_order` | `/bridge/api/v1/order/cancel_order` | 依 Shioaji trade ID 刪單。 | Not implemented (501) | Shioaji 傳送 `Trade.order.id`，Fubon 則需要原始完整的 order-result object；需要持久化關聯儲存。 |
| POST | `/api/v1/order/update_price` | `/bridge/api/v1/order/update_price` | 依 trade ID 修改委託價格。 | Not implemented (501) | 同樣需要持久化的 Shioaji trade-ID 與 Fubon order-result 關聯儲存。 |
| POST | `/api/v1/order/update_qty` | `/bridge/api/v1/order/update_qty` | 依 trade ID 減少委託數量。 | Not implemented (501) | 同樣需要持久化的 Shioaji trade-ID 與 Fubon order-result 關聯儲存。 |
| POST | `/api/v1/order/trades` | `/bridge/api/v1/order/trades` | 重新整理並列出股票或期貨／選擇權委託。 | Partial | Fubon order results 會轉換成巢狀的 Shioaji 形式交易；完整成交陣列、交易所時間戳及所有 Shioaji 狀態欄位均無法取得。 |
| POST | `/api/v1/order/place_comboorder` | `/bridge/api/v1/order/place_comboorder` | 下單期貨／選擇權組合委託。 | Not implemented (501) | 沒有記錄任何能保留 Shioaji 組合合約與組合腿語意的 Fubon 流程。 |
| POST | `/api/v1/order/cancel_comboorder` | `/bridge/api/v1/order/cancel_comboorder` | 取消組合委託。 | Not implemented (501) | 沒有對應的 Fubon 組合交易物件或穩定的組合 trade ID。 |
| POST | `/api/v1/order/combotrades` | `/bridge/api/v1/order/combotrades` | 列出組合交易。 | Not implemented (501) | 沒有記錄任何對應的 Fubon 組合交易查詢。 |
| POST | `/api/v1/order/stock_reserve_summary` | `/bridge/api/v1/order/stock_reserve_summary` | 查詢股票預約概要。 | Not implemented (501) | 沒有記錄任何對應的 Fubon 預約流程。 |
| POST | `/api/v1/order/stock_reserve_detail` | `/bridge/api/v1/order/stock_reserve_detail` | 查詢股票預約詳細資料。 | Not implemented (501) | 沒有記錄任何對應的 Fubon 預約流程。 |
| POST | `/api/v1/order/reserve_stock` | `/bridge/api/v1/order/reserve_stock` | 預約股票股數。 | Not implemented (501) | 沒有記錄任何對應的 Fubon 預約流程。 |
| POST | `/api/v1/order/earmarking_detail` | `/bridge/api/v1/order/earmarking_detail` | 查詢圈存詳細資料。 | Not implemented (501) | 沒有記錄任何對應的 Fubon 圈存流程。 |
| POST | `/api/v1/order/reserve_earmarking` | `/bridge/api/v1/order/reserve_earmarking` | 提交圈存預約。 | Not implemented (501) | 沒有記錄任何對應的 Fubon 圈存流程。 |
| POST | `/api/v1/order/order_deal_records` | `/bridge/api/v1/order/order_deal_records` | 查詢委託／成交對帳紀錄。 | Partial | 當前 Fubon order results 會包裝成 Shioaji 委託事件紀錄，但無法重現 Shioaji 完整的歷史委託／成交紀錄資料集。 |

## 投資組合與帳務

| Method | Shioaji route | Bridge route | Function | Status | Remaining work or limitation |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/portfolio/account_balance` | `/bridge/api/v1/portfolio/account_balance` | 查詢股票帳戶可用現金餘額。 | Partial | 對應 Fubon `availableBalance`；Fubon 未提供 Shioaji 查詢時間，因此 Bridge 會填入 Asia/Taipei 查詢完成時間。 |
| POST | `/api/v1/portfolio/margin` | `/bridge/api/v1/portfolio/margin` | 查詢期貨／選擇權保證金與權益。 | Partial | 對應 Fubon 保證金權益欄位；沒有 Fubon 來源的 Shioaji 欄位會回傳零。 |
| POST | `/api/v1/portfolio/position_unit` | `/bridge/api/v1/portfolio/position_unit` | 以 Common 或 Share 單位列出股票或期貨／選擇權部位。 | Partial | 股票部位會合併 Fubon 庫存與未實現損益；部分價格與數量為推導值。期貨／選擇權部位則由單一部位紀錄對應而來。 |
| POST | `/api/v1/portfolio/position_detail` | `/bridge/api/v1/portfolio/position_detail` | 依 Shioaji detail ID 查詢部位詳細資料。 | Not implemented (501) | Shioaji detail ID 是工作階段快取識別碼，沒有穩定的 Fubon 對應值。 |
| POST | `/api/v1/portfolio/settlements` | `/bridge/api/v1/portfolio/settlements` | 回傳含日期、金額與 T offset 的當前交割資料列。 | Partial | Fubon 三日交割資料會被轉換；因 Fubon 不回傳 Shioaji offset 欄位，`T` offset 依結果順序指定。 |
| POST | `/api/v1/portfolio/settlement` | `/bridge/api/v1/portfolio/settlement` | 回傳舊版 T／T+1／T+2 交割欄位。 | Partial | 由前三筆 Fubon 交割資料建立；缺少的資料列使用空日期與零金額。 |
| POST | `/api/v1/portfolio/trading_limits` | `/bridge/api/v1/portfolio/trading_limits` | 查詢現金、保證金與融券交易限額。 | Not implemented (501) | Fubon 維持率資料不等同於 Shioaji 的交易限額、已使用與可用金額。 |
| POST | `/api/v1/portfolio/profit_loss` | `/bridge/api/v1/portfolio/profit_loss` | 查詢已實現損益資料列。 | Partial | 股票結果透過 Bridge 端日期篩選與合成 list ID 支援；期貨／選擇權請求回傳 HTTP 501，因無法保留穩定的 Shioaji 資料列 ID 與所有詳細欄位。 |
| POST | `/api/v1/portfolio/profit_loss_detail` | `/bridge/api/v1/portfolio/profit_loss_detail` | 依 Shioaji detail ID 查詢已實現損益詳細資料。 | Not implemented (501) | Shioaji detail ID 沒有穩定的 Fubon 對應值。 |
| POST | `/api/v1/portfolio/profitloss_sum` | `/bridge/api/v1/portfolio/profitloss_sum` | 查詢已實現損益概要與總額。 | Partial | 支援股票概要；部分比例與進場價格欄位使用中性值。期貨／選擇權請求回傳 HTTP 501。 |

## 串流與 SSE

| Method | Shioaji route | Bridge route | Function | Status | Remaining work or limitation |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/stream/subscribe` | `/bridge/api/v1/stream/subscribe` | 訂閱股票或期貨／選擇權的 Tick、BidAsk 或 Quote 資料。 | Partial | 將訂閱轉換為共用的 Fubon 股票／futopt WebSocket；必須先收到確切的 Fubon acknowledgement，才能取消訂閱。 |
| POST | `/api/v1/stream/unsubscribe` | `/bridge/api/v1/stream/unsubscribe` | 取消市場資料訂閱。 | Partial | 若 Fubon 訂閱 acknowledgement 尚未提供上游訂閱 ID 就呼叫，會回傳 HTTP 409。 |
| GET | `/api/v1/stream/receivers` | `/bridge/api/v1/stream/receivers` | 回報可用的串流 receiver 類型。 | Complete | 以診斷文字回傳 Bridge receiver 名稱。 |
| GET | `/api/v1/stream/status` | `/bridge/api/v1/stream/status` | 回報作用中的 SSE 連線與 gateway 狀態。 | Complete | 連線數是 Bridge 本地數值，不代表 Fubon 上游連線配額。 |
| GET | `/api/v1/stream/data` | `/bridge/api/v1/stream/data` | 所有支援事件類型的合併 SSE 串流。 | Partial | 事件 payload 由 Fubon 欄位轉換而來；沒有來源的 Shioaji 專用欄位會省略或使用中性值。每 30 秒發送 heartbeat。 |
| GET | `/api/v1/stream/data/tick_stk` | `/bridge/api/v1/stream/data/tick_stk` | 股票成交逐筆 SSE 串流。 | Partial | 對應 Fubon `trades`；部分 Shioaji 買賣方總量與 tick 分類欄位無法取得或使用中性值。 |
| GET | `/api/v1/stream/data/bidask_stk` | `/bridge/api/v1/stream/data/bidask_stk` | 股票五檔買賣 SSE 串流。 | Partial | 對應 Fubon `books`；因 Fubon 未直接提供，Shioaji 差量陣列回傳零。 |
| GET | `/api/v1/stream/data/tick_fop` | `/bridge/api/v1/stream/data/tick_fop` | 期貨／選擇權成交逐筆 SSE 串流。 | Partial | 對應 Fubon futopt `trades`；Shioaji 專用的標的與買賣方總量欄位可能無法取得。 |
| GET | `/api/v1/stream/data/bidask_fop` | `/bridge/api/v1/stream/data/bidask_fop` | 期貨／選擇權五檔買賣 SSE 串流。 | Partial | 對應 Fubon futopt `books`；缺少的 Shioaji 差量欄位使用中性值。 |
| GET | `/api/v1/stream/data/quote_stk` | `/bridge/api/v1/stream/data/quote_stk` | 聚合股票報價 SSE 串流。 | Partial | 對應 Fubon `aggregates`；仍需針對固定版本的 Shioaji server 進行合約測試，才能達到精確的 Shioaji payload 一致性。 |
| GET | `/api/v1/stream/data/quote_fop` | `/bridge/api/v1/stream/data/quote_fop` | 聚合期貨／選擇權報價 SSE 串流。 | Partial | 對應 Fubon futopt `aggregates`；仍需進行合約測試，才能達到精確的 Shioaji 報價 payload 一致性。 |
| GET | `/api/v1/stream/data/order_event` | `/bridge/api/v1/stream/data/order_event` | 串流股票／期貨委託、改單與成交事件。 | Partial | Fubon 回呼會轉換為 Shioaji 事件類型；部分操作代碼、合約欄位、時間戳與快取的 Trade 關聯無法精確重現。 |

## 自選清單

| Method | Shioaji route | Bridge route | Function | Status | Remaining work or limitation |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/watchlist` | `/bridge/api/v1/watchlist` | 列出所有自選清單。 | Local-only | 儲存在記憶體中，程序重新啟動後會清除；因 Fubon 登入帳戶未公開 `person_id`，擁有者 `person_id` 為空。 |
| POST | `/api/v1/watchlist` | `/bridge/api/v1/watchlist` | 建立自選清單。 | Local-only | 合約物件會進行結構驗證，但不會針對所有 Fubon 商品目錄解析；狀態儲存在記憶體中。 |
| GET | `/api/v1/watchlist/{id}` | `/bridge/api/v1/watchlist/{id}` | 取得單一自選清單。 | Local-only | 狀態儲存在記憶體中，且僅限目前程序。 |
| PUT | `/api/v1/watchlist/{id}` | `/bridge/api/v1/watchlist/{id}` | 替換自選清單中的所有合約。 | Local-only | 狀態儲存在記憶體中；若要完整符合 daemon，需要加入持久化儲存與合約正規化。 |
| DELETE | `/api/v1/watchlist/{id}` | `/bridge/api/v1/watchlist/{id}` | 刪除自選清單。 | Local-only | 狀態儲存在記憶體中，無法跨伺服器程序共用。 |
| POST | `/api/v1/watchlist/{id}/contracts` | `/bridge/api/v1/watchlist/{id}/contracts` | 將合約加入自選清單。 | Local-only | 重複偵測使用證券類型、交易所、代號與目標代號，未進行券商端正規化。 |
| DELETE | `/api/v1/watchlist/{id}/contracts` | `/bridge/api/v1/watchlist/{id}/contracts` | 從自選清單移除合約。 | Local-only | 使用提交的合約識別資訊移除，不會先解析別名。 |

## 自訂應用程式

| Method | Shioaji route | Bridge route | Function | Status | Remaining work or limitation |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/apps` | `/bridge/api/v1/apps` | 列出已上傳的應用程式名稱。 | Local-only | 應用程式儲存在記憶體中，程序重新啟動後會清除。 |
| POST | `/api/v1/apps/{name}` | `/bridge/api/v1/apps/{name}` | 使用 multipart 欄位 `files` 上傳應用程式檔案。 | Local-only | 強制執行安全路徑、`Content-Length` 與 50 MB 請求限制；檔案不會持久化。巢狀檔案路徑會扁平化為安全檔名。 |
| DELETE | `/api/v1/apps/{name}` | `/bridge/api/v1/apps/{name}` | 刪除已上傳的應用程式。 | Local-only | 僅影響目前伺服器程序的記憶體儲存。 |
| GET | `/apps/{**path}` | `/bridge/apps/{app}/{file}` | 公開提供已上傳的應用程式檔案。 | Local-only | 支援一個應用程式名稱區段與一個安全檔名區段，不支援任意巢狀路徑。 |

## 優先 TODO

1. 新增持久化的交易關聯儲存，然後實作 `cancel_order`、`update_price` 與 `update_qty`。
2. 封存固定版本的 Shioaji 1.5 `/openapi.json`，並加入 request／response／SSE contract fixture，以精確比對欄位與 optional value。
3. 新增具帳戶擁有權的持久化自選清單與應用程式儲存。
4. 將完整的 Shioaji OpenAPI component schemas 加入 `/bridge/openapi.json`。
5. 在定義穩定的跨券商識別模型後，重新檢視期貨／選擇權合約中繼資料與已實現損益。
6. 在存在等價且可測試的 Fubon 資料來源前，讓組合、預約、圈存、法規、CA 到期、使用量、每日報價、detail-ID 與交易限額路由維持 HTTP 501。

## 來源參考

- `.agents/skills/fubon-neo-api/references/docs/`
- `.agents/skills/shioaji-api/references/docs/`
- Shioaji plugin 參考文件：`HTTP_API.md`、`ACCOUNTING.md`、`MARKET_DATA.md`、`ORDERS.md`、`STREAMING.md`、`WATCHLIST.md` 與 `CONCEPTS.md`
- Bridge 路由註冊表：`src/bridge/bridge.ts`
