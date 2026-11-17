import test from "node:test";
import assert from "node:assert/strict";
import { calculateTotal, type CartLine } from "../src/shared/calculateTotal.ts";
import { auditLog, runtimeConfig } from "../src/config.ts";
import { InventoryService } from "../src/inventory/InventoryService.ts";
import { CheckoutController } from "../src/checkout/CheckoutController.ts";
import { database, resetDatabase } from "../src/database.ts";

test("calculateTotal is pure, deterministic, and does not mutate input lines or auditLog", () => {
  auditLog.length = 0;
  runtimeConfig.taxRate = 0.5;
  runtimeConfig.discountPercent = 50;

  const lines: CartLine[] = [
    { productId: "book", unitPrice: 100, quantity: 2 },
    { productId: "pen", unitPrice: 50, quantity: 1 },
  ];
  const snapshotBefore = structuredClone(lines);

  const total1 = calculateTotal(lines, { taxRate: 0.2, discountPercent: 10 });
  const total2 = calculateTotal(lines, { taxRate: 0.2, discountPercent: 10 });

  assert.equal(total1, 270);
  assert.equal(total2, 270);
  assert.deepEqual(lines, snapshotBefore);
  assert.equal("lineTotal" in lines[0], false);
  assert.equal(auditLog.length, 0);
});

test("InventoryService.reserve rejects out-of-stock without partially mutating other items", () => {
  resetDatabase();
  database.stock.set("book", { productId: "book", available: 5 });
  database.stock.set("guitar", { productId: "guitar", available: 1 });

  const inventory = new InventoryService();

  assert.throws(
    () =>
      inventory.reserve([
        { productId: "book", quantity: 2 },
        { productId: "guitar", quantity: 2 },
      ]),
    /Insufficient stock for guitar/,
  );

  // Book stock must remain untouched (5, not 3)
  assert.equal(database.stock.get("book")?.available, 5);
  assert.equal(database.stock.get("guitar")?.available, 1);
});

test("CheckoutController preserves public response contract and does not mutate request lines", async () => {
  resetDatabase();
  auditLog.length = 0;
  runtimeConfig.taxRate = 0.2;
  runtimeConfig.discountPercent = 0;
  database.stock.set("book", { productId: "book", available: 10 });

  const inputLines: CartLine[] = [{ productId: "book", unitPrice: 150, quantity: 2 }];
  const response = await new CheckoutController().checkout({
    orderId: "order-stable",
    paymentToken: "tok_ok",
    currency: "UAH",
    lines: inputLines,
  });

  assert.deepEqual(response, {
    orderId: "order-stable",
    status: "confirmed",
    total: 360,
    paymentStatus: "paid",
  });
  assert.equal("lineTotal" in inputLines[0], false);
  assert.deepEqual(auditLog, ["total_calculated:360"]);
});