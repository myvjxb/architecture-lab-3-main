export type NormalizedPaymentStatus = "paid" | "processing" | "failed";

export function normalizePaymentStatus(providerState: string): NormalizedPaymentStatus {
  switch (providerState) {
    case "succeeded":
      return "paid";
    case "requires_action":
    case "processing":
      return "processing";
    case "declined":
      return "failed";
    default:
      return "failed";
  }
}