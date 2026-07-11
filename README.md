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