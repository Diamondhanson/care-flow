"use client";

/**
 * Patient Background panel (Phase 21) — demographics at a glance plus the
 * patient-level clinical history (`patient_history`), grouped by type.
 * Pinned near the allergies banner in the drawer, collapsed to the at-a-glance
 * strip by default. Pre-filled on every return visit: review-and-update, not
 * re-enter. Writable by nurse/doctor/admin (`canWrite`); read-only otherwise.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, UserRound } from "lucide-react";

import type {
  ClinicalTermCategory,
  MaritalStatus,
  Patient,
  PatientHistory,
  PatientHistoryType,
} from "@careflow/shared";
import {
  addPatientHistory,
  deletePatientHistory,
  getHistoryForPatient,
  PATIENT_HISTORY_TYPE_ORDER,
  updatePatientDemographics,
  updatePatientHistory,
  type AddPatientHistoryInput,
} from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TermAutocomplete } from "@/components/clinical-terms/term-autocomplete";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const HISTORY_TYPE_LABEL: Record<PatientHistoryType, string> = {
  past_medical: "historyType.past_medical",
  past_surgical: "historyType.past_surgical",
  family: "historyType.family",
  social: "historyType.social",
  obstetric_gynae: "historyType.obstetric_gynae",
  medication: "historyType.medication",
  immunization: "historyType.immunization",
};

export const MARITAL_STATUS_LABEL: Record<MaritalStatus, string> = {
  single: "maritalStatus.single",
  married: "maritalStatus.married",
  partnered: "maritalStatus.partnered",
  divorced: "maritalStatus.divorced",
  widowed: "maritalStatus.widowed",
  unknown: "maritalStatus.unknown",
};

const FAMILY_RELATIONS = ["father", "mother", "sibling", "child", "other"] as const;
const ALCOHOL_LEVELS = ["none", "occasional", "regular"] as const;

/**
 * History groups whose description autocompletes from a clinical-term library:
 * conditions (assessment) for past-medical and family history, the drug
 * catalogue for medications, surgical procedures for past-surgical, and the
 * vaccine list (Cameroon EPI schedule + common adult/travel) for
 * immunizations. Social and obstetric stay free text — their structured
 * selectors carry the signal.
 */
const HISTORY_TERM_CATEGORY: Partial<
  Record<PatientHistoryType, ClinicalTermCategory>
> = {
  past_medical: "assessment",
  past_surgical: "procedures",
  family: "assessment",
  medication: "medication",
  immunization: "immunizations",
};

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

interface HistoryDraft {
  description: string;
  onset: string;
  isActive: boolean | null;
  relation: string;
  alcohol: string;
  tobaccoPackYears: string;
  gravida: string;
  para: string;
  lmp: string;
}

const EMPTY_DRAFT: HistoryDraft = {
  description: "",
  onset: "",
  isActive: null,
  relation: "",
  alcohol: "",
  tobaccoPackYears: "",
  gravida: "",
  para: "",
  lmp: "",
};

function draftFromRecord(h: PatientHistory): HistoryDraft {
  const detail = (h.detail ?? {}) as Record<string, unknown>;
  return {
    description: h.description,
    onset: h.onset ?? "",
    isActive: h.is_active,
    relation: typeof detail.relation === "string" ? detail.relation : "",
    alcohol: typeof detail.alcohol === "string" ? detail.alcohol : "",
    tobaccoPackYears:
      typeof detail.tobacco_pack_years === "number"
        ? String(detail.tobacco_pack_years)
        : "",
    gravida: typeof detail.gravida === "number" ? String(detail.gravida) : "",
    para: typeof detail.para === "number" ? String(detail.para) : "",
    lmp: typeof detail.lmp === "string" ? detail.lmp : "",
  };
}

/** Assemble the type-specific `detail` jsonb from the draft (null when empty). */
function detailFromDraft(
  type: PatientHistoryType,
  d: HistoryDraft,
): Record<string, unknown> | null {
  if (type === "family") {
    return d.relation ? { relation: d.relation } : null;
  }
  if (type === "social") {
    const detail: Record<string, unknown> = {};
    if (d.alcohol) detail.alcohol = d.alcohol;
    if (d.tobaccoPackYears !== "" && Number.isFinite(Number(d.tobaccoPackYears))) {
      detail.tobacco_pack_years = Number(d.tobaccoPackYears);
    }
    return Object.keys(detail).length > 0 ? detail : null;
  }
  if (type === "obstetric_gynae") {
    const detail: Record<string, unknown> = {};
    if (d.gravida !== "" && Number.isFinite(Number(d.gravida))) {
      detail.gravida = Number(d.gravida);
    }
    if (d.para !== "" && Number.isFinite(Number(d.para))) {
      detail.para = Number(d.para);
    }
    if (d.lmp) detail.lmp = d.lmp;
    return Object.keys(detail).length > 0 ? detail : null;
  }
  return null;
}

export function BackgroundPanel({
  patient,
  recorderId,
  canWrite,
}: {
  patient: Patient;
  recorderId: string | null;
  canWrite: boolean;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<PatientHistory[]>([]);
  // The drawer's `patient` prop goes stale once demographics are edited here,
  // so the panel keeps its own copy, refreshed from each mutation's return.
  const [patientState, setPatientState] = useState<Patient>(patient);
  // The open inline form: adding to a group, or editing one record.
  const [form, setForm] = useState<
    | { mode: "add"; type: PatientHistoryType }
    | { mode: "edit"; record: PatientHistory }
    | null
  >(null);
  const [draft, setDraft] = useState<HistoryDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);

  // Demographics inline editor (occupation · marital status). Emergency
  // contact is registration data — captured and kept on the intake form.
  const [editingDemo, setEditingDemo] = useState(false);
  const [demoDraft, setDemoDraft] = useState({
    occupation: "",
    maritalStatus: "unknown" as MaritalStatus,
  });

  const refresh = useCallback(() => {
    setHistory(getHistoryForPatient(patient.id));
  }, [patient.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setPatientState(patient);
    setEditingDemo(false);
  }, [patient]);

  function openDemoEditor() {
    setDemoDraft({
      occupation: patientState.occupation ?? "",
      maritalStatus: patientState.marital_status ?? "unknown",
    });
    setEditingDemo(true);
  }

  function saveDemographics() {
    const updated = updatePatientDemographics(patientState.id, {
      occupation: demoDraft.occupation || null,
      marital_status: demoDraft.maritalStatus,
    });
    setPatientState(updated);
    setEditingDemo(false);
  }

  const age = ageFromDob(patientState.date_of_birth);
  // Rows hydrated from a hosted schema that predates Phase 21 lack the new
  // demographic columns entirely — treat missing as unrecorded, never crash.
  const maritalLabel =
    patientState.marital_status && patientState.marital_status !== "unknown"
      ? t(MARITAL_STATUS_LABEL[patientState.marital_status])
      : null;
  // "Unknown" sex reads like a status badge in the strip — omit it instead.
  const glance = [
    age !== null ? t("background.ageYears", { age: String(age) }) : null,
    patientState.sex !== "unknown" ? t(`sex.${patientState.sex}`) : null,
    patientState.occupation,
    maritalLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const formType = form?.mode === "add" ? form.type : form?.record.type;

  function openAdd(type: PatientHistoryType) {
    setForm({ mode: "add", type });
    setDraft(EMPTY_DRAFT);
    setFormError(null);
  }

  function openEdit(record: PatientHistory) {
    setForm({ mode: "edit", record });
    setDraft(draftFromRecord(record));
    setFormError(null);
  }

  function closeForm() {
    setForm(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
  }

  function handleSave() {
    if (!form || !formType) return;
    if (!draft.description.trim()) {
      setFormError(t("background.descriptionRequired"));
      return;
    }
    const input: AddPatientHistoryInput = {
      type: formType,
      description: draft.description,
      detail: detailFromDraft(formType, draft),
      onset: draft.onset || null,
      is_active: formType === "past_medical" ? draft.isActive : null,
      noted_by_id: recorderId,
    };
    try {
      if (form.mode === "add") {
        addPatientHistory(patient.id, input);
      } else {
        updatePatientHistory(form.record.id, {
          description: input.description,
          detail: input.detail,
          onset: input.onset,
          is_active: input.is_active,
          noted_by_id: recorderId,
        });
      }
      closeForm();
      refresh();
    } catch {
      setFormError(t("background.saveFailed"));
    }
  }

  function handleDelete() {
    if (form?.mode !== "edit") return;
    deletePatientHistory(form.record.id);
    closeForm();
    refresh();
  }

  return (
    <section className="flex flex-col rounded-md border border-border bg-muted/40">
      {/* At-a-glance strip — always visible; tap to expand the full record. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-2 p-3 text-left"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <UserRound
          className="size-4 shrink-0"
          style={{ color: "var(--status-diagnostics)" }}
        />
        <h3 className="text-sm font-semibold">{t("background.title")}</h3>
        <span className="ml-auto truncate font-mono text-xs text-muted-foreground">
          {glance || (
            <span className="font-sans italic text-muted-foreground/60">
              {t("background.notRecorded")}
            </span>
          )}
        </span>
        {history.length > 0 ? (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {history.length}
          </Badge>
        ) : null}
      </button>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {history.length === 0 && !glance ? (
            <p className="text-xs italic text-muted-foreground/70">
              {t("background.explainer")}
            </p>
          ) : null}

          {/* Demographics — captured at intake, editable here afterwards. */}
          {editingDemo ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2.5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="demo_occupation" className="text-xs">
                    {t("background.occupation")}
                  </Label>
                  <Input
                    id="demo_occupation"
                    value={demoDraft.occupation}
                    onChange={(e) =>
                      setDemoDraft({ ...demoDraft, occupation: e.target.value })
                    }
                    placeholder={t("intake.occupationPlaceholder")}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="demo_marital" className="text-xs">
                    {t("background.maritalStatus")}
                  </Label>
                  <Select
                    items={Object.fromEntries(
                      (Object.keys(MARITAL_STATUS_LABEL) as MaritalStatus[]).map(
                        (m) => [m, t(MARITAL_STATUS_LABEL[m])],
                      ),
                    )}
                    value={demoDraft.maritalStatus}
                    onValueChange={(v) =>
                      setDemoDraft({
                        ...demoDraft,
                        maritalStatus: v as MaritalStatus,
                      })
                    }
                  >
                    <SelectTrigger id="demo_marital" className="h-8 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MARITAL_STATUS_LABEL) as MaritalStatus[]).map(
                        (m) => (
                          <SelectItem key={m} value={m}>
                            {t(MARITAL_STATUS_LABEL[m])}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={saveDemographics}>
                  {t("common.save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setEditingDemo(false)}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <DemographicItem
                  label={t("background.occupation")}
                  value={patientState.occupation}
                />
                <DemographicItem
                  label={t("background.maritalStatus")}
                  value={maritalLabel}
                />
              </dl>
              {canWrite ? (
                <button
                  type="button"
                  aria-label={t("background.editDemographics")}
                  onClick={openDemoEditor}
                  className="shrink-0 pt-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
              ) : null}
            </div>
          )}

          {/* History groups, in clinical order — two columns on the wide drawer. */}
          <div className="grid gap-3 lg:grid-cols-2 lg:gap-x-6">
          {PATIENT_HISTORY_TYPE_ORDER.map((type) => {
            const items = history.filter((h) => h.type === type);
            const isAddingHere = form?.mode === "add" && form.type === type;
            return (
              <div key={type} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(HISTORY_TYPE_LABEL[type])}
                  </span>
                  {canWrite && !form ? (
                    <button
                      type="button"
                      onClick={() => openAdd(type)}
                      className="inline-flex items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                    >
                      <Plus className="size-3" />
                      {t("background.add")}
                    </button>
                  ) : null}
                </div>

                {items.length === 0 && !isAddingHere ? (
                  canWrite && !form ? (
                    // The empty state itself is an add target — one obvious tap.
                    <button
                      type="button"
                      onClick={() => openAdd(type)}
                      className="self-start rounded-md border border-dashed border-border px-2 py-1 text-left text-xs text-muted-foreground/70 transition-colors hover:border-primary hover:text-foreground"
                    >
                      {t("background.noneRecordedAdd")}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">
                      {t("background.noneRecorded")}
                    </span>
                  )
                ) : (
                  <ul className="flex flex-col gap-1">
                    {items.map((h) =>
                      form?.mode === "edit" && form.record.id === h.id ? (
                        <li key={h.id}>
                          <HistoryForm
                            type={type}
                            draft={draft}
                            setDraft={setDraft}
                            error={formError}
                            onSave={handleSave}
                            onCancel={closeForm}
                            onDelete={handleDelete}
                            patientSex={patient.sex}
                          />
                        </li>
                      ) : (
                        <li key={h.id} className="flex items-start gap-2 text-xs">
                          <span className="flex-1">
                            <span className="font-medium">{h.description}</span>
                            {historyMeta(h, t) ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {historyMeta(h, t)}
                              </span>
                            ) : null}
                          </span>
                          {type === "past_medical" && h.is_active !== null ? (
                            <Badge
                              variant="outline"
                              className="shrink-0 text-[10px]"
                              style={
                                h.is_active
                                  ? {
                                      borderColor: "var(--status-treatment)",
                                      color: "var(--status-treatment)",
                                    }
                                  : undefined
                              }
                            >
                              {h.is_active
                                ? t("background.active")
                                : t("background.resolved")}
                            </Badge>
                          ) : null}
                          {canWrite && !form ? (
                            <button
                              type="button"
                              aria-label={t("background.edit")}
                              onClick={() => openEdit(h)}
                              className="shrink-0 text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="size-3" />
                            </button>
                          ) : null}
                        </li>
                      ),
                    )}
                  </ul>
                )}

                {isAddingHere ? (
                  <HistoryForm
                    type={type}
                    draft={draft}
                    setDraft={setDraft}
                    error={formError}
                    onSave={handleSave}
                    onCancel={closeForm}
                    patientSex={patient.sex}
                  />
                ) : null}
              </div>
            );
          })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DemographicItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {label}
      </dt>
      <dd className={mono ? "font-mono" : ""}>{value || "—"}</dd>
    </div>
  );
}

/** "onset · structured detail" summary line after the description. */
function historyMeta(
  h: PatientHistory,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  const parts: string[] = [];
  const detail = (h.detail ?? {}) as Record<string, unknown>;
  if (typeof detail.relation === "string") {
    parts.push(t(`background.relation.${detail.relation}`));
  }
  if (h.onset) parts.push(h.onset);
  if (typeof detail.alcohol === "string") {
    parts.push(
      `${t("background.alcohol")}: ${t(`background.alcoholLevel.${detail.alcohol}`)}`,
    );
  }
  if (typeof detail.tobacco_pack_years === "number") {
    parts.push(
      t("background.packYears", { count: String(detail.tobacco_pack_years) }),
    );
  }
  if (typeof detail.gravida === "number") parts.push(`G${detail.gravida}`);
  if (typeof detail.para === "number") parts.push(`P${detail.para}`);
  if (typeof detail.lmp === "string") {
    parts.push(`${t("background.lmp")} ${detail.lmp}`);
  }
  return parts.join(" · ");
}

function HistoryForm({
  type,
  draft,
  setDraft,
  error,
  onSave,
  onCancel,
  onDelete,
  patientSex,
}: {
  type: PatientHistoryType;
  draft: HistoryDraft;
  setDraft: (d: HistoryDraft) => void;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  patientSex: Patient["sex"];
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2.5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bg_description" className="text-xs">
          {t("background.description")}
        </Label>
        {HISTORY_TERM_CATEGORY[type] ? (
          // Conditions / drugs autocomplete from the clinical-term library —
          // the doctor picks rather than types.
          <TermAutocomplete
            id="bg_description"
            category={HISTORY_TERM_CATEGORY[type]}
            value={draft.description}
            onChange={(v) => setDraft({ ...draft, description: v })}
            placeholder={t(`background.placeholder.${type}`)}
            inputClassName="h-8 text-xs"
          />
        ) : (
          <Input
            id="bg_description"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder={t(`background.placeholder.${type}`)}
            className="h-8 text-xs"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bg_onset" className="text-xs">
            {t("background.onset")}
          </Label>
          <Input
            id="bg_onset"
            value={draft.onset}
            onChange={(e) => setDraft({ ...draft, onset: e.target.value })}
            placeholder={t("background.onsetPlaceholder")}
            className="h-8 text-xs"
          />
        </div>

        {type === "past_medical" ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">{t("background.status")}</span>
            <div className="inline-flex h-8 overflow-hidden rounded-md border border-border">
              <button
                type="button"
                aria-pressed={draft.isActive === true}
                onClick={() =>
                  setDraft({
                    ...draft,
                    isActive: draft.isActive === true ? null : true,
                  })
                }
                className={`flex-1 px-2 text-xs ${
                  draft.isActive === true
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("background.active")}
              </button>
              <button
                type="button"
                aria-pressed={draft.isActive === false}
                onClick={() =>
                  setDraft({
                    ...draft,
                    isActive: draft.isActive === false ? null : false,
                  })
                }
                className={`flex-1 border-l border-border px-2 text-xs ${
                  draft.isActive === false
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("background.resolved")}
              </button>
            </div>
          </div>
        ) : null}

        {type === "family" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bg_relation" className="text-xs">
              {t("background.relationLabel")}
            </Label>
            <Select
              items={Object.fromEntries(
                FAMILY_RELATIONS.map((r) => [r, t(`background.relation.${r}`)]),
              )}
              value={draft.relation}
              onValueChange={(v) => setDraft({ ...draft, relation: v as string })}
            >
              <SelectTrigger id="bg_relation" className="h-8 w-full text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {FAMILY_RELATIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`background.relation.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {type === "social" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bg_alcohol" className="text-xs">
              {t("background.alcohol")}
            </Label>
            <Select
              items={Object.fromEntries(
                ALCOHOL_LEVELS.map((l) => [l, t(`background.alcoholLevel.${l}`)]),
              )}
              value={draft.alcohol}
              onValueChange={(v) => setDraft({ ...draft, alcohol: v as string })}
            >
              <SelectTrigger id="bg_alcohol" className="h-8 w-full text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {ALCOHOL_LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`background.alcoholLevel.${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bg_pack_years" className="text-xs">
              {t("background.tobaccoPackYears")}
            </Label>
            <Input
              id="bg_pack_years"
              type="number"
              inputMode="numeric"
              min={0}
              max={200}
              value={draft.tobaccoPackYears}
              onChange={(e) =>
                setDraft({ ...draft, tobaccoPackYears: e.target.value })
              }
              className="h-8 font-mono text-xs"
            />
          </div>
        </div>
      ) : null}

      {type === "obstetric_gynae" && patientSex !== "male" ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bg_gravida" className="text-xs">
              {t("background.gravida")}
            </Label>
            <Input
              id="bg_gravida"
              type="number"
              inputMode="numeric"
              min={0}
              max={30}
              value={draft.gravida}
              onChange={(e) => setDraft({ ...draft, gravida: e.target.value })}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bg_para" className="text-xs">
              {t("background.para")}
            </Label>
            <Input
              id="bg_para"
              type="number"
              inputMode="numeric"
              min={0}
              max={30}
              value={draft.para}
              onChange={(e) => setDraft({ ...draft, para: e.target.value })}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bg_lmp" className="text-xs">
              {t("background.lmp")}
            </Label>
            <Input
              id="bg_lmp"
              type="date"
              value={draft.lmp}
              onChange={(e) => setDraft({ ...draft, lmp: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={onSave}>
          {t("common.save")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        {onDelete ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-xs text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            {t("background.delete")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
