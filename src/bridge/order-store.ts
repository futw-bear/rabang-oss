import { Database } from "bun:sqlite";

export interface StoredOrder {
  tradeId: string;
  accountType: "S" | "F";
  brokerId: string;
  accountId: string;
  future: boolean;
  contract: Record<string, unknown>;
  orderInput: Record<string, unknown>;
  orderResult: Record<string, unknown>;
}

interface StoredOrderRow {
  trade_id: string;
  account_type: "S" | "F";
  broker_id: string;
  account_id: string;
  future: number;
  contract: string;
  order_input: string;
  order_result: string;
}

export interface OrderStore {
  get(tradeId: string): StoredOrder | undefined;
  put(order: StoredOrder): void;
}

export class SqliteOrderStore implements OrderStore, Disposable {
  readonly #database: Database;
  readonly #get;
  readonly #put;

  constructor(filename = ":memory:") {
    this.#database = new Database(filename, { create: true, strict: true });
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS bridge_orders (
        trade_id TEXT PRIMARY KEY,
        account_type TEXT NOT NULL CHECK (account_type IN ('S', 'F')),
        broker_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        future INTEGER NOT NULL CHECK (future IN (0, 1)),
        contract TEXT NOT NULL,
        order_input TEXT NOT NULL,
        order_result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.#get = this.#database.query<StoredOrderRow, [string]>(`
      SELECT trade_id, account_type, broker_id, account_id, future,
             contract, order_input, order_result
      FROM bridge_orders
      WHERE trade_id = ?
    `);
    this.#put = this.#database.query<
      unknown,
      [string, string, string, string, number, string, string, string]
    >(`
      INSERT INTO bridge_orders (
        trade_id, account_type, broker_id, account_id, future,
        contract, order_input, order_result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trade_id) DO UPDATE SET
        account_type = excluded.account_type,
        broker_id = excluded.broker_id,
        account_id = excluded.account_id,
        future = excluded.future,
        contract = excluded.contract,
        order_input = excluded.order_input,
        order_result = excluded.order_result,
        updated_at = CURRENT_TIMESTAMP
    `);
  }

  get(tradeId: string): StoredOrder | undefined {
    const row = this.#get.get(tradeId);
    if (!row) return undefined;
    return {
      tradeId: row.trade_id,
      accountType: row.account_type,
      brokerId: row.broker_id,
      accountId: row.account_id,
      future: row.future === 1,
      contract: parseRecord(row.contract),
      orderInput: parseRecord(row.order_input),
      orderResult: parseRecord(row.order_result),
    };
  }

  put(order: StoredOrder): void {
    this.#put.run(
      order.tradeId,
      order.accountType,
      order.brokerId,
      order.accountId,
      order.future ? 1 : 0,
      JSON.stringify(order.contract),
      JSON.stringify(order.orderInput),
      JSON.stringify(order.orderResult),
    );
  }

  close(): void {
    this.#database.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Stored order data is invalid");
  }
  return parsed as Record<string, unknown>;
}
