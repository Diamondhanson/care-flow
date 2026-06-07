"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BedDouble,
  CheckCircle2,
  ClipboardList,
  HeartHandshake,
  MessageSquarePlus,
  Plus,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  addCarePlanEntry,
  addCarePlanItem,
  getCarePlanEntriesForAdmission,
  getCarePlanItemsForAdmission,
  getAdmittedPatientsForCarePlan,
  getStaffById,
  resolveCarePlanItem,
  type CarePlanPatient,
} from "@/services/mockStorage";
import {
  CARE_NEED_CATEGORIES,
  CARE_NEED_CATEGORY_ICON,
  CARE_NEED_CATEGORY_LABEL,
} from "@/components/care-plans/care-plans";
import { useRole } from "@/components/role-provider";
import { useT, type TFunction } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type {
  CareNeedCategory,
  CarePlanEntry,
  CarePlanItem,
} from "@/types/healthcare";

/** The patient's display name, honoring the anonymous-emergency tag. */
function patientName(p: CarePlanPatient, t: TFunction): string {
  const patient = p.patient;
  if (!patient) return t("meds.unknownPatient");
  return patient.is_emergency_anonymous && patient.anonymous_identifier
    ? patient.anonymous_identifier
    : patient.full_name;
}

/** Ward · bed unit label for an admitted patient. */
function unitLabel(p: CarePlanPatient): string {
  const ward = p.ward?.name ?? "—";
  return p.bed ? `${ward} · ${p.bed.label}` : ward;
}

function staffName(id: string | null): string | null {
  if (!id) return null;
  return getStaffById(id)?.full_name ?? null;
}

/** Left-rail patient row. */
function PatientRow({
  patient,
  active,
  onSelect,
  t,
}: {
  patient: CarePlanPatient;
  active: boolean;
  onSelect: () => void;
  t: TFunction;
}) {
  const isAnonymous = patient.patient?.is_emergency_anonymous ?? false;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group relative flex w-full flex-col gap-1 rounded-lg border px-3.5 py-3 text-left transition-colors",
        active
          ? "border-primary/40 bg-accent"
          : "border-border bg-card hover:bg-accent/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-sm",
            isAnonymous ? "font-mono" : "font-medium",
          )}
        >
          {patientName(patient, t)}
        </span>
        {patient.activeNeeds > 0 ? (
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {t("carePlan.needsActive", { count: patient.activeNeeds })}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BedDouble className="size-3.5" />
        <span className="truncate">{unitLabel(patient)}</span>
      </div>
      {patient.latestHandover ? (
        <span
          className="inline-flex w-fit items-center gap-1 text-[11px] font-medium"
          style={{ color: "var(--status-boarding)" }}
        >
          <HeartHandshake className="size-3" />
          {t("carePlan.handoverWaiting")}
        </span>
      ) : null}
    </button>
  );
}

/** A single care-need card with its resolve action. */
function NeedCard({
  item,
  onResolve,
  t,
}: {
  item: CarePlanItem;
  onResolve: () => void;
  t: TFunction;
}) {
  const Icon = CARE_NEED_CATEGORY_ICON[item.category];
  const resolved = item.status === "resolved";
  return (
    <Card className={cn(resolved && "opacity-60")}>
      <CardContent className="flex items-start gap-3 p-4">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-md"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--status-treatment) 14%, transparent)",
            color: "var(--status-treatment)",
          }}
        >
          <Icon className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t(CARE_NEED_CATEGORY_LABEL[item.category])}
            </span>
            {resolved ? (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <CheckCircle2 className="size-3" />
                {t("carePlan.statusResolved")}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm">{item.description}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {item.frequency ? (
              <span>
                {t("carePlan.field.frequency")}: {item.frequency}
              </span>
            ) : null}
            {item.goal ? (
              <span>
                {t("carePlan.field.goal")}: {item.goal}
              </span>
            ) : null}
          </div>
        </div>
        {!resolved ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={onResolve}
          >
            {t("carePlan.resolve")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Quick-pick + fields to add a new care need. */
function AddNeedForm({
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

/** Append-only care log entry. */
function LogEntry({
  entry,
  items,
  activeLocale,
  t,
}: {
  entry: CarePlanEntry;
  items: CarePlanItem[];
  activeLocale: "en" | "fr";
  t: TFunction;
}) {
  const need = entry.care_plan_item_id
    ? items.find((i) => i.id === entry.care_plan_item_id)
    : undefined;
  const by = staffName(entry.recorded_by_id);
  return (
    <div className="flex flex-col gap-1 border-l-2 border-border pl-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {entry.is_handover ? (
          <Badge
            className="gap-1 text-[10px] uppercase"
            style={{
              backgroundColor: "var(--status-boarding)",
              color: "var(--status-boarding-foreground)",
            }}
          >
            <HeartHandshake className="size-3" />
            {t("carePlan.handoverTag")}
          </Badge>
        ) : null}
        {need ? (
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("carePlan.forNeed", {
              need: t(CARE_NEED_CATEGORY_LABEL[need.category]),
            })}
          </span>
        ) : null}
      </div>
      <p className="text-sm">{entry.note}</p>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {by ? `${by} · ` : ""}
        {formatDateTime(entry.recorded_at, activeLocale)}
      </span>
    </div>
  );
}

/** Record-care / leave-handover form. */
function RecordCareForm({
  activeItems,
  onAdd,
  t,
}: {
  activeItems: CarePlanItem[];
  onAdd: (input: {
    note: string;
    careItemId: string | null;
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
      careItemId: careItemId === "none" ? null : careItemId,
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

export default function CarePlansPage() {
  const { actingStaff } = useRole();
  const { t, locale, mounted } = useT();
  const activeLocale = mounted ? locale : "en";

  const [patients, setPatients] = useState<CarePlanPatient[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ward, setWard] = useState<string>("all");
  const [items, setItems] = useState<CarePlanItem[]>([]);
  const [entries, setEntries] = useState<CarePlanEntry[]>([]);

  function refreshPatients() {
    setPatients(getAdmittedPatientsForCarePlan());
  }

  function refreshDetail(admissionId: string | null) {
    if (!admissionId) {
      setItems([]);
      setEntries([]);
      return;
    }
    setItems(getCarePlanItemsForAdmission(admissionId));
    setEntries(getCarePlanEntriesForAdmission(admissionId));
  }

  // localStorage is client-only, so the first read happens after mount (keeps
  // SSR + first paint stable), mirroring the medications page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPatients();
  }, []);

  // Auto-select the first patient once the list loads.
  useEffect(() => {
    if (patients && patients.length > 0 && selectedId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(patients[0].admission.id);
    }
  }, [patients, selectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshDetail(selectedId);
  }, [selectedId]);

  const wards = useMemo(() => {
    const names = new Set<string>();
    for (const p of patients ?? []) if (p.ward?.name) names.add(p.ward.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [patients]);

  const wardItems = useMemo(() => {
    const entries: Record<string, string> = { all: t("carePlan.allWards") };
    for (const w of wards) entries[w] = w;
    return entries;
  }, [wards, t]);

  const visible = useMemo(() => {
    if (!patients) return [];
    return ward === "all"
      ? patients
      : patients.filter((p) => p.ward?.name === ward);
  }, [patients, ward]);

  const selected = useMemo(
    () => patients?.find((p) => p.admission.id === selectedId) ?? null,
    [patients, selectedId],
  );

  const activeItems = items.filter((i) => i.status === "active");
  const latestHandover = entries.find((e) => e.is_handover) ?? null;

  function handleAddNeed(input: {
    category: CareNeedCategory;
    description: string;
    frequency: string;
    goal: string;
  }) {
    if (!selectedId) return;
    addCarePlanItem(selectedId, {
      category: input.category,
      description: input.description,
      frequency: input.frequency.trim() || null,
      goal: input.goal.trim() || null,
      created_by_id: actingStaff?.id ?? null,
    });
    refreshDetail(selectedId);
    refreshPatients();
  }

  function handleResolve(itemId: string) {
    resolveCarePlanItem(itemId);
    refreshDetail(selectedId);
    refreshPatients();
  }

  function handleAddEntry(input: {
    note: string;
    careItemId: string | null;
    isHandover: boolean;
  }) {
    if (!selectedId) return;
    addCarePlanEntry(selectedId, {
      note: input.note,
      care_plan_item_id: input.careItemId,
      is_handover: input.isHandover,
      recorded_by_id: actingStaff?.id ?? null,
    });
    refreshDetail(selectedId);
    refreshPatients();
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("carePlan.title")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("carePlan.subtitle")}
        </p>
      </header>

      {patients === null ? (
        <p className="text-sm text-muted-foreground">{t("carePlan.loading")}</p>
      ) : patients.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardList className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t("carePlan.noPatients")}</p>
            <p className="text-xs text-muted-foreground">
              {t("carePlan.noPatientsHint")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          {/* Master — patient list + ward filter */}
          <aside className="flex flex-col gap-3">
            {wards.length > 1 ? (
              <Select
                items={wardItems}
                value={ward}
                onValueChange={(v) => setWard(v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("carePlan.allWards")}</SelectItem>
                  {wards.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <div className="flex flex-col gap-2">
              {visible.map((p) => (
                <PatientRow
                  key={p.admission.id}
                  patient={p}
                  active={p.admission.id === selectedId}
                  onSelect={() => setSelectedId(p.admission.id)}
                  t={t}
                />
              ))}
            </div>
          </aside>

          {/* Detail — the selected patient's plan */}
          {selected ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-0.5">
                <span
                  className={cn(
                    "text-lg",
                    selected.patient?.is_emergency_anonymous
                      ? "font-mono"
                      : "font-semibold",
                  )}
                >
                  {patientName(selected, t)}
                </span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <BedDouble className="size-4" />
                  {unitLabel(selected)}
                </span>
              </div>

              {/* Latest handover banner */}
              {latestHandover ? (
                <Card
                  style={{
                    borderColor:
                      "color-mix(in oklab, var(--status-boarding) 40%, transparent)",
                  }}
                >
                  <CardContent className="flex flex-col gap-1 p-4">
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: "var(--status-boarding)" }}
                    >
                      <HeartHandshake className="size-3.5" />
                      {t("carePlan.latestHandover")}
                    </span>
                    <p className="text-sm">{latestHandover.note}</p>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {staffName(latestHandover.recorded_by_id)
                        ? `${staffName(latestHandover.recorded_by_id)} · `
                        : ""}
                      {formatDateTime(latestHandover.recorded_at, activeLocale)}
                    </span>
                  </CardContent>
                </Card>
              ) : null}

              {/* Care needs */}
              <section className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-sm font-semibold">
                    {t("carePlan.needsBlock")}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t("carePlan.needsBlockHint")}
                  </p>
                </div>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("carePlan.noNeeds")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {items.map((item) => (
                      <NeedCard
                        key={item.id}
                        item={item}
                        onResolve={() => handleResolve(item.id)}
                        t={t}
                      />
                    ))}
                  </div>
                )}
                <AddNeedForm onAdd={handleAddNeed} t={t} />
              </section>

              {/* Care log + handover */}
              <section className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-sm font-semibold">
                    {t("carePlan.logBlock")}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t("carePlan.logBlockHint")}
                  </p>
                </div>
                {entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("carePlan.noLog")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {entries.map((entry) => (
                      <LogEntry
                        key={entry.id}
                        entry={entry}
                        items={items}
                        activeLocale={activeLocale}
                        t={t}
                      />
                    ))}
                  </div>
                )}
                <RecordCareForm
                  activeItems={activeItems}
                  onAdd={handleAddEntry}
                  t={t}
                />
              </section>
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <ClipboardList className="size-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">
                  {t("carePlan.selectPatient")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("carePlan.selectPatientHint")}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
