# Rabang OSS

[![Publish Package](https://github.com/futw-bear/rabang-oss/actions/workflows/publish-image.yml/badge.svg)](https://github.com/futw-bear/rabang-oss/actions/workflows/publish-image.yml)
[![Test](https://github.com/futw-bear/rabang-oss/actions/workflows/test.yml/badge.svg)](https://github.com/futw-bear/rabang-oss/actions/workflows/test.yml)

Rabang OSS 是一個開源的臺灣證券 API/SDK 聚合器。

## Configuration

```env
FUBON_PERSONAL_ID   # 證券帳戶身份證字號
FUBON_PASSWORD      # 證券帳戶密碼，與 FUBON_API_KEY 互斥
FUBON_API_KEY       # 證券帳戶 APIKey，與 FUBON_PASSWORD 互斥
FUBON_CERT_PATH     # 證券帳戶憑證路徑
FUBON_CERT_PASSWORD # 證券帳戶憑證密碼，選填（未填寫的話會直接使用 FUBON_PERSONAL_ID 的值）

# 連線中斷恢復策略：當 Websocket 連線 60 秒未能收到 heartbeat 時，會自動進入 recovery 流程，有兩個可選值
SERVER_GATEWAY_RECOVERY=relogin         # 嘗試重新登入
SERVER_GATEWAY_RECOVERY=restart-gateway # 重新啟動 Gateway Subporcess 
```

## 支援的券商

- [富邦證券 Fubon Security](https://www.fbs.com.tw/)

## Shioaji Bridge

可以在部份功能上相容於[永豐金證券的 Shioaji](https://sinotrade.github.io/zh/)。

交易下單等功能 **不建議** 由 Shioaji Bridge 執行，因為與富邦證券所提供的 API 相容範圍有限，可能發生預期外的情況。

### Shiaoji Pro 整合

可以與 [Shioaji Pro](https://github.com/Sinotrade/shioaji-pro-app) 一起使用，但有部份功能因為富邦證券 API 缺失而無法使用。

**重要提醒**：**不要**經由 Shiaoji Pro 進行交易操作，目前 API Bridge 的功能尚不完全穩定、具有非常高的風險，應該僅作為看盤使用。

1. 啟動 Rabang OSS 服務，並且確認有連線成功
2. 執行以下指令
```
$ git clone git@github.com:Sinotrade/shioaji-pro-app.git
$ cd shioaji-pro-app
$ bun i
```

3. 建立 `.env`，並在其中加入以下內容
```
VITE_API_TARGET=http://127.0.0.1:4000/bridge
```

4. 啟動 Shioaji Pro
```
$ bun dev
```
