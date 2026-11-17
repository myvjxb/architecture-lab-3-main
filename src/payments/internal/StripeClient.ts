import { markOrderPaid } from "../../orders/internal/orderMutations.ts";

export type StripePayload = {
  id: string;
  amount: number;
  currency: string;
  metadata: { orderId: string };
};

export type StripeResponse = {
  charge_id: string;
  state: "succeeded" | "requires_action" | "declined" | string;
};

export class StripeClient {
  async createCharge(payload: StripePayload): Promise<StripeResponse> {
    let state: StripeResponse["state"] = "succeeded";
    if (payload.id.startsWith("fail_")) {
      state = "declined";
    } else if (payload.id.startsWith("proc_")) {
      state = "requires_action";
    }

    const response: StripeResponse = { charge_id: `ch_${payload.id}`, state };
    markOrderPaid(payload.metadata.orderId, state === "succeeded" ? "paid" : "failed");
    return response;
  }
}