import { database, type StockRow } from "../database.ts";

export class StockRepository {
  find(productId: string): StockRow | undefined {
    return database.stock.get(productId);
  }

  save(row: StockRow): void {
    if (row.available < 0) {
      throw new Error(`Stock invariant violated for ${row.productId}: available cannot be negative`);
    }
    database.stock.set(row.productId, { ...row });
  }
}