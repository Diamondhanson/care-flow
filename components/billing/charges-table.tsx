"use client";

import { CheckCircle2, MinusCircle, Settings2, Trash2, Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BillSummary } from "@/components/billing/billing";
import { type TFunction } from "@/components/locale-provider";
import { formatXaf } from "@/i18n/format";
import type { Charge, ChargeId, ChargeStatus } from "@/types/healthcare";

/** Clinical `--status-*` tone behind each charge-status chip. */
const CHARGE_STATUS_TONE: Record<ChargeStatus, StatusTone> = {
  paid: "clearance",
  waived: "boarding",
  pending: "treatment",
};

// ---------------------------------------------------------------------------
// A single charge row in the bill
// ---------------------------------------------------------------------------

function ChargeRow({
  charge,
  locale,
  onStatus,
  onRemove,
  t,
}: {
  charge: Charge;
  locale: "en" | "fr";
  onStatus: (status: ChargeStatus) => void;
  onRemove: () => void;
  t: TFunction;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm">{charge.description}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            {charge.quantity} × {formatXaf(charge.unit_price, locale)}
          </span>
          <StatusBadge tone={CHARGE_STATUS_TONE[charge.status]}>
            {t(`billing.status.${charge.status}`)}
          </StatusBadge>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm tabular-nums">{formatXaf(charge.amount, locale)}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("billing.colActions") || "actions"}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings2 className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {charge.status !== "paid" ? (
              <DropdownMenuItem onClick={() => onStatus("paid")}>
                <CheckCircle2 className="size-4" />
                {t("billing.markPaid")}
              </DropdownMenuItem>
            ) : null}
            {charge.status !== "waived" ? (
              <DropdownMenuItem onClick={() => onStatus("waived")}>
                <MinusCircle className="size-4" />
                {t("billing.markWaived")}
              </DropdownMenuItem>
            ) : null}
            {charge.status !== "pending" ? (
              <DropdownMenuItem onClick={() => onStatus("pending")}>
                {t("billing.markPending")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2 className="size-4" />
              {t("billing.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** The itemised bill: category groups, discounts, and the totals card. */
export function ChargesTable({
  summary,
  locale,
  onStatus,
  onRemove,
  onSettle,
  t,
}: {
  summary: BillSummary;
  locale: "en" | "fr";
  onStatus: (chargeId: ChargeId, status: ChargeStatus) => void;
  onRemove: (chargeId: ChargeId) => void;
  onSettle: () => void;
  t: TFunction;
}) {
  return (
    <>
      {/* Grouped itemised charges */}
      <div className="flex flex-col gap-4">
        {summary.groups.map((group) => (
          <Card key={group.category}>
            <CardContent className="flex flex-col gap-1 p-4">
              <div className="flex items-center justify-between gap-2 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t(`billing.category.${group.category}`)}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatXaf(group.subtotal, locale)}
                </span>
              </div>
              {group.lines.map((c) => (
                <ChargeRow
                  key={c.id}
                  charge={c}
                  locale={locale}
                  onStatus={(s) => onStatus(c.id, s)}
                  onRemove={() => onRemove(c.id)}
                  t={t}
                />
              ))}
            </CardContent>
          </Card>
        ))}

        {summary.discounts.length > 0 ? (
          <Card>
            <CardContent className="flex flex-col gap-1 p-4">
              <span className="pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("billing.source.discount")}
              </span>
              {summary.discounts.map((c) => (
                <ChargeRow
                  key={c.id}
                  charge={c}
                  locale={locale}
                  onStatus={(s) => onStatus(c.id, s)}
                  onRemove={() => onRemove(c.id)}
                  t={t}
                />
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Totals */}
      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("billing.subtotal")}</span>
            <span className="font-mono tabular-nums">
              {formatXaf(summary.itemsSubtotal, locale)}
            </span>
          </div>
          {summary.discountTotal > 0 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("billing.discountTotal")}</span>
              <span className="font-mono tabular-nums">
                −{formatXaf(summary.discountTotal, locale)}
              </span>
            </div>
          ) : null}
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2.5">
            <span className="flex items-center gap-2 text-base font-semibold">
              <Wallet className="size-4 text-muted-foreground" />
              {t("billing.grandTotal")}
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {formatXaf(summary.grandTotal, locale)}
            </span>
          </div>
          {summary.isFullySettled ? (
            <div
              className="mt-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{
                color: "var(--status-clearance)",
                backgroundColor: "color-mix(in oklab, var(--status-clearance) 14%, transparent)",
              }}
            >
              <CheckCircle2 className="size-3.5" />
              {t("billing.settled")}
            </div>
          ) : (
            <Button className="mt-1.5 w-full" onClick={onSettle}>
              <Wallet className="size-4" />
              {t("billing.settle")}
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  );
}
