import { describe, expect, it } from "vitest";

import {
  COMMON_ORDERS,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TOKEN,
  ORDER_TYPE_LABEL,
  hasAbnormalResult,
  isOrderOpen,
} from "@/components/diagnostics/orders";
import type { Result } from "@/types/healthcare";

function result(partial: Partial<Result>): Result {
  return {
    id: "res_x",
    order_id: "ord_x",
    recorded_by_id: null,
    summary: null,
    value: null,
    reference_range: null,
    is_abnormal: false,
    attachment_path: null,
    recorded_at: "2026-05-31T00:00:00.000Z",
    ...partial,
  };
}

describe("order label maps", () => {
  it("labels every order type", () => {
    expect(ORDER_TYPE_LABEL.lab).toBe("Lab");
    expect(ORDER_TYPE_LABEL.imaging).toBe("Imaging");
    expect(ORDER_TYPE_LABEL.procedure).toBe("Procedure");
  });

  it("labels every order status", () => {
    expect(ORDER_STATUS_LABEL.requested).toBe("Requested");
    expect(ORDER_STATUS_LABEL.in_progress).toBe("In progress");
    expect(ORDER_STATUS_LABEL.completed).toBe("Completed");
    expect(ORDER_STATUS_LABEL.cancelled).toBe("Cancelled");
  });

  it("maps each status to a theme token", () => {
    expect(ORDER_STATUS_TOKEN.requested).toBe("boarding");
    expect(ORDER_STATUS_TOKEN.in_progress).toBe("diagnostics");
    expect(ORDER_STATUS_TOKEN.completed).toBe("discharge");
    expect(ORDER_STATUS_TOKEN.cancelled).toBe("muted");
  });
});

describe("isOrderOpen", () => {
  it("treats requested and in_progress as open", () => {
    expect(isOrderOpen("requested")).toBe(true);
    expect(isOrderOpen("in_progress")).toBe(true);
  });

  it("treats completed and cancelled as closed", () => {
    expect(isOrderOpen("completed")).toBe(false);
    expect(isOrderOpen("cancelled")).toBe(false);
  });
});

describe("hasAbnormalResult", () => {
  it("is false for an empty set", () => {
    expect(hasAbnormalResult([])).toBe(false);
  });

  it("is false when all results are normal", () => {
    expect(
      hasAbnormalResult([result({ is_abnormal: false }), result({ is_abnormal: false })])
    ).toBe(false);
  });

  it("is true when any result is abnormal", () => {
    expect(
      hasAbnormalResult([result({ is_abnormal: false }), result({ is_abnormal: true })])
    ).toBe(true);
  });
});

describe("COMMON_ORDERS quick-picks", () => {
  it("offers suggestions for every order type", () => {
    expect(COMMON_ORDERS.lab.length).toBeGreaterThan(0);
    expect(COMMON_ORDERS.imaging.length).toBeGreaterThan(0);
    expect(COMMON_ORDERS.procedure.length).toBeGreaterThan(0);
  });
});
