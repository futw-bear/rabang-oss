---
name: fubon-neo-api
description: Build, review, debug, and explain integrations with the Fubon Neo securities and futures APIs using a bundled offline copy of the official documentation. Use for Fubon Neo authentication, SDK installation, stock or futures trading, account queries, smart conditional orders, HTTP market data, WebSocket subscriptions, callbacks, error codes, rate limits, and Python, Node.js, C#, or C++ examples.
---

# Fubon Neo API

Use the bundled official documentation as the source of truth. Do not rely on memory for method names, enum values, request fields, response fields, limits, or error semantics.
Resolve every relative path below from the directory containing this `SKILL.md`.

## Find the relevant documentation

1. Search `references/llms.txt` for a document title, API method, product, language, or topic.
2. Open the matching local file under `references/docs/`. Preserve the path following the official `/TradeAPI/docs/` prefix.
3. Read nearby overview, preparation, enum matrix, error-code, and rate-limit documents when they affect the task.
4. Compare language-specific documents only when translating an example or resolving inconsistent behavior.

Use `rg` to avoid loading the complete documentation set:

```bash
rg -n -i 'place_order|建立委託單' references/llms.txt references/docs
rg -l -i 'websocket|callback' references/docs/market-data references/docs/trading
```

## Implement safely

- Determine whether the task concerns securities or futures before selecting a document.
- Determine the SDK language and version before producing code.
- Follow the exact enum members and signatures in the matching language-specific document.
- Separate market-data HTTP behavior, market-data WebSocket behavior, and trading callback behavior.
- Include authentication, certificate, account selection, callback registration, and cleanup when required by the documented flow.
- Never invent credentials, account identifiers, certificates, order identifiers, or production endpoints.
- Treat order placement, modification, cancellation, and conditional orders as state-changing operations. Explain the effect and use non-production placeholders in examples.
- Surface documented rate limits, compatibility constraints, and error handling relevant to the implementation.
- Cite local documentation paths in the response so the developer can verify the implementation offline.

## Resolve documentation conflicts

Prefer the most specific document in this order:

1. Product and language-specific API reference
2. Product guide or quickstart
3. Shared introduction or installation document
4. Index description in `references/llms.txt`

State the discrepancy instead of silently combining incompatible signatures. Check `references/manifest.json` for the local snapshot timestamp and source URL when freshness matters.

## Update the offline snapshot

Run the bundled updater manually from the repository root:

```bash
python3 .agents/skills/fubon-neo-api/scripts/update_documents.py
```

When invoking it elsewhere, pass the absolute path to `scripts/update_documents.py`. The updater resolves its output from its own location, downloads the official index and every indexed document, validates their URLs, writes files atomically, records SHA-256 hashes in `references/manifest.json`, and removes files no longer present in the official index. Network access is required only for this update command.
