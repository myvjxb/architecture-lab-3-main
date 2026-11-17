import {
  normalizePaymentStatus,
  type NormalizedPaymentStatus,
} from "../payments/normalizePaymentStatus.ts";

export function mapPaymentStatus(response: { state: string }): NormalizedPaymentStatus {
  return normalizePaymentStatus(response.state);
}