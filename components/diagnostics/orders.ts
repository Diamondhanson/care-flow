import type { OrderStatus, OrderType, Result } from "@/types/healthcare";

/** Human-readable label for a diagnostic order type. */
export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  lab: "Lab",
  imaging: "Imaging",
  procedure: "Procedure",
};

/** Human-readable label for an order's lifecycle status. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  requested: "Requested",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
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

/** Common quick-pick tests per order type, to speed up doctor ordering. */
export const COMMON_ORDERS: Record<OrderType, string[]> = {
  lab: [
    "Full Blood Count",
    "Urea & Electrolytes",
    "Liver Function Tests",
    "Fasting Blood Glucose",
    "HbA1c",
    "Troponin I",
    "C-Reactive Protein",
    "Malaria RDT",
  ],
  imaging: [
    "Chest X-ray (PA)",
    "Abdominal Ultrasound",
    "CT head (non-contrast)",
    "ECG",
    "Echocardiogram",
  ],
  procedure: ["Lumbar puncture", "Wound debridement", "Endoscopy"],
};

/** True when any result in the set is flagged abnormal — drives highlighting. */
export function hasAbnormalResult(results: Result[]): boolean {
  return results.some((r) => r.is_abnormal);
}
