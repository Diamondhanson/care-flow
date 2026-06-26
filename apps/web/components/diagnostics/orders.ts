import type { OrderStatus, OrderType, Result } from "@/types/healthcare";

/** i18n key for a diagnostic order type — resolve with `t(ORDER_TYPE_LABEL[type])`. */
export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  lab: "orderType.lab",
  imaging: "orderType.imaging",
  procedure: "orderType.procedure",
};

/** i18n key for an order's lifecycle status. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  requested: "orderStatus.requested",
  in_progress: "orderStatus.in_progress",
  completed: "orderStatus.completed",
  cancelled: "orderStatus.cancelled",
};

/**
 * The clinical theme token a status maps to, for badge/dot colouring. Open work
 * (requested/in_progress) reads as "diagnostics"; a closed loop reads "done".
 */
export const ORDER_STATUS_TOKEN: Record<
  OrderStatus,
  "boarding" | "diagnostics" | "discharge" | "muted"
> = {
  requested: "boarding",
  in_progress: "diagnostics",
  completed: "discharge",
  cancelled: "muted",
};

/** An order awaiting a result still sits in the diagnostics queue. */
export function isOrderOpen(status: OrderStatus): boolean {
  return status === "requested" || status === "in_progress";
}

/** True when any result in the set is flagged abnormal — drives highlighting. */
export function hasAbnormalResult(results: Result[]): boolean {
  return results.some((r) => r.is_abnormal);
}
