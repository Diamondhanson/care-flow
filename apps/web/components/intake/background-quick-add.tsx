"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HISTORY_TYPE_LABEL } from "@/components/patient/background-panel";
import { useT } from "@/components/locale-provider";
import type { PatientHistoryType } from "@careflow/shared";

export interface BackgroundEntry {
  type: PatientHistoryType;
  description: string;
}

/**
 * Optional background quick-add (Phase 21) — collapsed by default so intake
 * stays fast; the doctor can complete the background in consult. Entries are
 * buffered locally by the page and written as patient_history rows on submit.
 */
export function BackgroundQuickAddCard({
  show,
  onToggle,
  bgType,
  setBgType,
  bgDescription,
  setBgDescription,
  entries,
  setEntries,
}: {
  show: boolean;
  onToggle: () => void;
  bgType: PatientHistoryType;
  setBgType: (v: PatientHistoryType) => void;
  bgDescription: string;
  setBgDescription: (v: string) => void;
  entries: BackgroundEntry[];
  setEntries: (v: BackgroundEntry[]) => void;
}) {
  const { t } = useT();

  function addEntry() {
    if (!bgDescription.trim()) return;
    setEntries([...entries, { type: bgType, description: bgDescription.trim() }]);
    setBgDescription("");
  }

  return (
    <Card>
      <CardHeader className="pb-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={show}
          className="flex items-center gap-2 text-left"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {t("intake.background")}
          </span>
          <span className="text-xs text-muted-foreground">
            {show ? t("intake.backgroundHide") : t("intake.backgroundShow")}
          </span>
          {entries.length > 0 ? (
            <span className="font-mono text-xs text-muted-foreground">
              ({entries.length})
            </span>
          ) : null}
        </button>
      </CardHeader>
      {show ? (
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            {t("intake.backgroundHint")}
          </p>
          {entries.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {entries.map((entry, i) => (
                <li
                  key={`${entry.type}-${i}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="text-xs text-muted-foreground">
                    {t(HISTORY_TYPE_LABEL[entry.type])}
                  </span>
                  <span className="flex-1">{entry.description}</span>
                  <button
                    type="button"
                    onClick={() => setEntries(entries.filter((_, j) => j !== i))}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {t("common.remove")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              items={Object.fromEntries(
                (Object.keys(HISTORY_TYPE_LABEL) as PatientHistoryType[]).map(
                  (k) => [k, t(HISTORY_TYPE_LABEL[k])],
                ),
              )}
              value={bgType}
              onValueChange={(v) => setBgType(v as PatientHistoryType)}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(HISTORY_TYPE_LABEL) as PatientHistoryType[]).map(
                  (k) => (
                    <SelectItem key={k} value={k}>
                      {t(HISTORY_TYPE_LABEL[k])}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Input
              value={bgDescription}
              onChange={(e) => setBgDescription(e.target.value)}
              placeholder={t("intake.backgroundPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addEntry();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={!bgDescription.trim()}
              onClick={addEntry}
            >
              {t("common.add")}
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
