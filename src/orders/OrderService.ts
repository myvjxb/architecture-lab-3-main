import { database } from "../database.ts";
import type { CartLine } from "../shared/calculateTotal.ts";
import { InventoryService } from "../inventory/InventoryService.ts";
import { PaymentService } from "../payments/PaymentService.ts";

export type PlaceOrderInput = {
  orderId: string;
  lines: readonly CartLine[];
  total: number;
  currency: string;
  paymentToken: string;
};

export class OrderService {
  private readonly inventory: InventoryService;
  private readonly payments: PaymentService;

  constructor(
    inventory = new InventoryService(),
    payments = new PaymentService(),
  ) {
    this.inventory = inventory;
    this.payments = payments;
  }

  async placeOrder(input: PlaceOrderInput) {
    this.inventory.reserve(
      input.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
    );

    database.orders.set(input.orderId, {
      id: input.orderId,
      status: "created",
      total: input.total,
    });

    const paymentResult = await this.payments.authorize({
      orderId: input.orderId,
      paymentToken: input.paymentToken,
      amount: input.total,
      currency: input.currency,
    });

    const order = database.orders.get(input.orderId)!;
    order.paymentStatus = paymentResult.status;
    order.status = paymentResult.status === "paid" ? "confirmed" : "payment_pending";

    return { ...order };
  }
}