"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CARE_NEED_CATEGORIES,
  CARE_NEED_CATEGORY_ICON,
  CARE_NEED_CATEGORY_LABEL,
} from "@/components/care-plans/care-plans";
import { type TFunction } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import type { CareNeedCategory } from "@/types/healthcare";

/** Quick-pick + fields to add a new care need. */
export function AddNeedForm({
  onAdd,
  t,
}: {
  onAdd: (input: {
    category: CareNeedCategory;
    description: string;
    frequency: string;
    goal: string;
  }) => void;
  t: TFunction;
}) {
  const [category, setCategory] = useState<CareNeedCategory | null>(null);
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState("");
  const [goal, setGoal] = useState("");

  function submit() {
    if (!category || !description.trim()) return;
    onAdd({ category, description: description.trim(), frequency, goal });
    setCategory(null);
    setDescription("");
    setFrequency("");
    setGoal("");
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plus className="size-4 text-muted-foreground" />
          {t("carePlan.addNeed")}
        </div>
        {/* Low-friction quick-pick — one tap sets the category. */}
        <div className="flex flex-wrap gap-1.5">
          {CARE_NEED_CATEGORIES.map((cat) => {
            const Icon = CARE_NEED_CATEGORY_ICON[cat];
            const selected = category === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                aria-pressed={selected}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {t(CARE_NEED_CATEGORY_LABEL[cat])}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="need-desc">{t("carePlan.field.description")}</Label>
          <Textarea
            id="need-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("carePlan.field.descriptionPlaceholder")}
            rows={2}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="need-freq">{t("carePlan.field.frequency")}</Label>
            <Input
              id="need-freq"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              placeholder={t("carePlan.field.frequencyPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="need-goal">{t("carePlan.field.goal")}</Label>
            <Input
              id="need-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t("carePlan.field.goalPlaceholder")}
            />
          </div>
        </div>
        <div>
          <Button
            size="sm"
            onClick={submit}
            disabled={!category || !description.trim()}
          >
            {t("carePlan.saveNeed")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
