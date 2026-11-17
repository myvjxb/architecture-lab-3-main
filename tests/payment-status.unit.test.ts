import test from "node:test";
import assert from "node:assert/strict";
import { normalizePaymentStatus } from "../src/payments/normalizePaymentStatus.ts";
import { CheckoutController } from "../src/checkout/CheckoutController.ts";
import { database, resetDatabase } from "../src/database.ts";

test("normalizePaymentStatus maps succeeded to paid", () => {
  assert.equal(normalizePaymentStatus("succeeded"), "paid");
});

test("normalizePaymentStatus maps requires_action and processing to processing", () => {
  assert.equal(normalizePaymentStatus("requires_action"), "processing");
  assert.equal(normalizePaymentStatus("processing"), "processing");
});

test("normalizePaymentStatus maps declined to failed", () => {
  assert.equal(normalizePaymentStatus("declined"), "failed");
});

test("normalizePaymentStatus safely defaults unknown provider status to failed", () => {
  assert.equal(normalizePaymentStatus("unexpected_gateway_code"), "failed");
  assert.equal(normalizePaymentStatus(""), "failed");
});

test("checkout handles processing payment status without confirming order", async () => {
  resetDatabase();
  database.stock.set("book", { productId: "book", available: 5 });

  const response = await new CheckoutController().checkout({
    orderId: "order-proc",
    paymentToken: "proc_3ds",
    currency: "UAH",
    lines: [{ productId: "book", unitPrice: 100, quantity: 1 }],
  });

  assert.equal(response.paymentStatus, "processing");
  assert.equal(response.status, "payment_pending");
});