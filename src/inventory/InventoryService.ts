import { StockRepository } from "./StockRepository.ts";

export type ReservationItem = {
  productId: string;
  quantity: number;
};

export class InventoryService {
  private readonly repository: StockRepository;

  constructor(repository = new StockRepository()) {
    this.repository = repository;
  }

  getAvailable(productId: string): number {
    return this.repository.find(productId)?.available ?? 0;
  }

  /**
   * Atomically validates and reserves all requested items.
   * Either all items are reserved or none are modified (preserving available >= 0).
   */
  reserve(items: readonly ReservationItem[]): void {
    const requiredByProduct = new Map<string, number>();

    for (const item of items) {
      if (item.quantity <= 0) {
        throw new Error(`Invalid reservation quantity for ${item.productId}`);
      }
      requiredByProduct.set(
        item.productId,
        (requiredByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }

    // Phase 1: Validate all invariants before mutating any state
    const plannedUpdates: Array<{ productId: string; newAvailable: number }> = [];
    for (const [productId, requiredQty] of requiredByProduct.entries()) {
      const current = this.repository.find(productId);
      if (!current || current.available < requiredQty) {
        throw new Error(`Insufficient stock for ${productId}`);
      }
      plannedUpdates.push({
        productId,
        newAvailable: current.available - requiredQty,
      });
    }

    // Phase 2: Commit all updates atomically
    for (const update of plannedUpdates) {
      this.repository.save({
        productId: update.productId,
        available: update.newAvailable,
      });
    }
  }
}