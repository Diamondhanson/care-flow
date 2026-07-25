"use client";

import { useMemo, useState } from "react";
import { MessageSquarePlus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CARE_NEED_CATEGORY_LABEL } from "@/components/care-plans/care-plans";
import { type TFunction } from "@/components/locale-provider";
import type { CarePlanItem, CarePlanItemId } from "@/types/healthcare";

/** Record-care / leave-handover form. */
export function RecordCareForm({
  activeItems,
  onAdd,
  t,
}: {
  activeItems: CarePlanItem[];
  onAdd: (input: {
    note: string;
    careItemId: CarePlanItemId | null;
    isHandover: boolean;
  }) => void;
  t: TFunction;
}) {
  const [note, setNote] = useState("");
  const [careItemId, setCareItemId] = useState<string>("none");
  const [isHandover, setIsHandover] = useState(false);

  function submit() {
    if (!note.trim()) return;
    onAdd({
      note: note.trim(),
      // The select's value is a raw DOM string; brand it at this boundary.
      careItemId: careItemId === "none" ? null : (careItemId as CarePlanItemId),
      isHandover,
    });
    setNote("");
    setCareItemId("none");
    setIsHandover(false);
  }

  const needItems = useMemo(() => {
    const entries: Record<string, string> = {
      none: t("carePlan.generalNote"),
    };
    for (const i of activeItems) {
      entries[i.id] = `${t(CARE_NEED_CATEGORY_LABEL[i.category])} — ${i.description}`;
    }
    return entries;
  }, [activeItems, t]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquarePlus className="size-4 text-muted-foreground" />
          {t("carePlan.recordCare")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="care-note">{t("carePlan.noteField")}</Label>
          <Textarea
            id="care-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              isHandover
                ? t("carePlan.handoverNotePlaceholder")
                : t("carePlan.notePlaceholder")
            }
            rows={2}
          />
        </div>
        {activeItems.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="care-link">{t("carePlan.field.category")}</Label>
            <Select
              items={needItems}
              value={careItemId}
              onValueChange={(v) => setCareItemId(v as string)}
            >
              <SelectTrigger id="care-link" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("carePlan.generalNote")}</SelectItem>
                {activeItems.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {t(CARE_NEED_CATEGORY_LABEL[i.category])} — {i.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <span className="flex flex-col">
            <span className="text-sm font-medium">
              {t("carePlan.markHandover")}
            </span>
          </span>
          <Switch checked={isHandover} onCheckedChange={setIsHandover} />
        </label>
        <div>
          <Button size="sm" onClick={submit} disabled={!note.trim()}>
            {isHandover ? t("carePlan.leaveHandover") : t("carePlan.saveNote")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
