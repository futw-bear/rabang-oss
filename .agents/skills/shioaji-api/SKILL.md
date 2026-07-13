---
name: shioaji-api
description: Build, review, debug, and explain integrations with the Shioaji trading API using a bundled offline copy of the official documentation. Use for Shioaji installation, simulation mode, authentication, contracts, stock, futures, options, combo and odd-lot orders, order and deal callbacks, streaming and historical market data, account queries, certificates, limits, and Python examples.
---

# Shioaji API

Use the bundled official documentation as the source of truth. Do not rely on
memory for method names, enum values, request fields, response fields, limits,
or callback semantics. Resolve every relative path below from the directory
containing this `SKILL.md`.

## Find the relevant documentation

1. Search `references/llms.txt` for a title, API method, product, or topic.
2. Open the matching local Markdown file under `references/docs/`. Preserve
   the path following the official `https://sinotrade.github.io/` prefix.
3. Read nearby login, contract, limit, callback, simulation, and preparation
   documents when they affect the task.

Use `rg` to avoid loading the complete documentation set:

```bash
rg -n -i 'place_order|下單|委託' references/llms.txt references/docs
rg -l -i 'callback|event|行情|streaming' references/docs
```

## Implement safely

- Determine whether the task concerns stocks, futures, options, or combo
  orders before selecting an order document.
- Determine the installed Shioaji version before producing integration code.
- Follow exact signatures, enum members, contract selection, and callback
  registration from the matching official document.
- Separate streaming quotes, historical data, order callbacks, and account
  queries.
- Include login, account and contract selection, certificate activation,
  callback registration, and logout or cleanup when required by the documented
  workflow.
- Never invent API keys, secret keys, personal identifiers, account IDs,
  certificates, contract codes, order IDs, or production endpoints.
- Treat login, certificate activation, order placement, modification,
  cancellation, and token operations as state-changing or sensitive actions.
  Explain their effects and use simulation mode or placeholders in examples.
- Surface documented usage limits, environment constraints, and error handling
  relevant to the implementation.
- Cite local documentation paths so the developer can verify the result
  offline.

## Resolve documentation conflicts

Prefer the most specific product and operation document over general login,
environment setup, or preparation documents. State a discrepancy instead of
silently combining incompatible examples. Check `references/manifest.json`
for snapshot time and source URL when freshness matters.

## Update the offline snapshot

Run the bundled updater manually from the repository root:

```bash
python3 .agents/skills/shioaji-api/scripts/update_documents.py
```

The updater downloads only the official `sinotrade.github.io` index and
Markdown documents, validates paths, writes files atomically, records SHA-256
hashes, and removes files no longer present in the official index.
