import { StripeClient } from "./internal/StripeClient.ts";
import {
  normalizePaymentStatus,
  type NormalizedPaymentStatus,
} from "./normalizePaymentStatus.ts";

export type AuthorizePaymentRequest = {
  orderId: string;
  paymentToken: string;
  amount: number;
  currency: string;
};

export type AuthorizePaymentResult = {
  paymentId: string;
  status: NormalizedPaymentStatus;
};

export class PaymentService {
  private readonly client: StripeClient;

  constructor(client = new StripeClient()) {
    this.client = client;
  }

  async authorize(request: AuthorizePaymentRequest): Promise<AuthorizePaymentResult> {
    const response = await this.client.createCharge({
      id: request.paymentToken,
      amount: Math.round(request.amount * 100),
      currency: request.currency,
      metadata: { orderId: request.orderId },
    });

    return {
      paymentId: response.charge_id,
      status: normalizePaymentStatus(response.state),
    };
  }
}