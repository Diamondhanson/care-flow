"use client";

import { useState } from "react";
import { AlertTriangle, FlaskConical } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TOKEN,
  ORDER_TYPE_LABEL,
} from "@/components/diagnostics/orders";
import { ResultAttachment } from "@/components/diagnostics/result-attachment";
import { TermAutocomplete } from "@/components/clinical-terms/term-autocomplete";
import { displayTerm } from "@/lib/clinical-terms/search";
import {
  addOrder,
  deleteOrder,
  updateOrder,
  type UpdateOrderInput,
} from "@/services/mockStorage";
import { useT, useLocale } from "@/components/locale-provider";
import { DeleteControl } from "@/components/live-board/drawer/delete-control";
import { useFormReset } from "@/components/live-board/drawer/use-drawer-data";
import type {
  ClinicalTerm,
  Order,
  OrderId,
  OrderType,
  Result,
  StaffId,
  VisitId,
} from "@careflow/shared";

/**
 * Diagnostic orders & results. Tests are instant-added from the term picker
 * below the list, then refined inline on each row. A mistaken order can be
 * removed via a two-step in-place delete confirm.
 */
export function OrdersPanel({
  visitId,
  recorderId,
  orders,
  results,
  resetKey,
  onMutated,
}: {
  visitId: VisitId;
  recorderId: StaffId | null;
  orders: Order[];
  results: Result[];
  resetKey: string;
  onMutated: () => void;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const [orderDraft, setOrderDraft] = useState("");
  // A two-step confirm for deleting a mistaken order.
  const [pendingDeleteId, setPendingDeleteId] = useState<OrderId | null>(null);

  // Reset the draft (and any armed delete) on drawer open / after a save.
  useFormReset(resetKey, () => {
    setOrderDraft("");
    setPendingDeleteId(null);
  });

  function handleAddOrder(description: string, orderType: OrderType) {
    const label = description.trim();
    if (!label) return;
    addOrder(visitId, {
      ordered_by_id: recorderId,
      order_type: orderType,
      description: label,
    });
    onMutated();
  }

  function handleUpdateOrder(orderId: OrderId, input: UpdateOrderInput) {
    updateOrder(orderId, input);
    onMutated();
  }

  function handleDeleteOrder(orderId: OrderId) {
    deleteOrder(orderId);
    setPendingDeleteId(null);
    onMutated();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("drawer.ordersResults")}</span>
      </div>

      {orders.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {orders.map((o) => {
            const orderResults = results.filter((r) => r.order_id === o.id);
            const token = ORDER_STATUS_TOKEN[o.status];
            return (
              <li
                key={o.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-sm font-medium">{o.description}</span>
                    <Select
                      items={Object.fromEntries(
                        (Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map(
                          (ot) => [ot, t(ORDER_TYPE_LABEL[ot])],
                        ),
                      )}
                      value={o.order_type}
                      onValueChange={(v) =>
                        handleUpdateOrder(o.id, {
                          order_type: v as OrderType,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={t("drawer.testType")}
                        className="h-7 w-fit gap-1 text-[11px] uppercase tracking-wide"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map(
                          (ot) => (
                            <SelectItem key={ot} value={ot}>
                              {t(ORDER_TYPE_LABEL[ot])}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {token === "muted" ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-transparent text-[10px] uppercase"
                      >
                        {t(ORDER_STATUS_LABEL[o.status])}
                      </Badge>
                    ) : (
                      <StatusBadge tone={token} variant="solid">
                        {t(ORDER_STATUS_LABEL[o.status])}
                      </StatusBadge>
                    )}
                    <DeleteControl
                      armed={pendingDeleteId === o.id}
                      onArm={() => setPendingDeleteId(o.id)}
                      onCancel={() => setPendingDeleteId(null)}
                      onConfirm={() => handleDeleteOrder(o.id)}
                      label={t("drawer.deleteOrder")}
                      confirmLabel={t("drawer.confirmDelete")}
                      cancelLabel={t("drawer.cancelDelete")}
                    />
                  </div>
                </div>

                {orderResults.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-col gap-1 rounded-md border border-border bg-background p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">
                        {r.value ?? "—"}
                        {r.reference_range ? (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {t("drawer.refRange", { range: r.reference_range })}
                          </span>
                        ) : null}
                      </span>
                      {r.is_abnormal ? (
                        <StatusBadge
                          tone="treatment"
                          variant="solid"
                          className="shrink-0"
                        >
                          <AlertTriangle className="size-3" />
                          {t("drawer.abnormal")}
                        </StatusBadge>
                      ) : null}
                    </div>
                    {r.summary ? (
                      <p className="text-xs text-muted-foreground">{r.summary}</p>
                    ) : null}
                    {r.attachment_path ? (
                      <ResultAttachment path={r.attachment_path} />
                    ) : null}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("drawer.noOrders")}</p>
      )}

      {/* Add a test — instant-adds to the list above on pick. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="order-desc" className="text-xs">
          {t("drawer.test")}
        </Label>
        <TermAutocomplete
          id="order-desc"
          category="investigations"
          value={orderDraft}
          onChange={setOrderDraft}
          clearOnSelect
          onSelectTerm={(term: ClinicalTerm) => {
            handleAddOrder(
              displayTerm(term, activeLocale),
              term.order_type ?? "lab",
            );
          }}
          onCommit={(label) => handleAddOrder(label, "lab")}
          placeholder={t("drawer.testPlaceholder")}
        />
      </div>
    </div>
  );
}
