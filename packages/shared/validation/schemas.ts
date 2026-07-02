/**
 * Composite validation schemas (security hardening) — built from the primitives.
 *
 * Two consumer groups:
 *   - Trust boundary (service-role server actions, auth/OTP RPC): parsed with
 *     `safeParse` / `parseOrError` so a friendly error is returned before any
 *     privileged Supabase call runs.
 *   - Core service-layer mutators (intake / results / MAR / vitals): parsed for
 *     the THROW side-effect only (the original object is kept, so no field is
 *     ever stripped — see lib/validation/primitives.ts).
 *
 * Required-ness intentionally mirrors what the app already enforces: optional/
 * empty stays permissive, so validation never rejects input that works today.
 */

import { z } from "zod";

import {
  zBodySystem,
  zCareStage,
  zEmail,
  zId,
  zMarStatus,
  zMaritalStatus,
  MAR_REASON_REQUIRED,
  zOptEmail,
  zOptId,
  zOptIsoDate,
  zOptLine,
  zOptNumber,
  zOptPhone,
  zOptText,
  zOtpToken,
  zPassword,
  zPatientHistoryType,
  zReqLine,
  zRosAnswerType,
  zRosQuestionKind,
  zSex,
  zStaffRole,
  zTriageLevel,
  zUsername,
  zUuid,
  zVisitType,
} from "./primitives";

// ---------------------------------------------------------------------------
// Trust boundary — service-role server actions (app/actions/auth.ts)
// ---------------------------------------------------------------------------

export const ProvisionStaffLoginSchema = z.object({
  // Validated AFTER normalizeUsername() (lowercased); mirrors the DB
  // chk_staff_username_fmt constraint so app + DB agree.
  username: zUsername,
  password: zPassword,
  full_name: zReqLine(120),
  role: zStaffRole,
  hospital_id: zUuid,
  mock_hospital_id: zId,
  mock_staff_id: zId,
});

export const ProvisionHospitalSchema = z.object({
  name: zReqLine(200),
  region: zOptLine(120),
  contact_email: zOptEmail,
  contact_phone: zOptPhone,
  admin_full_name: zReqLine(120),
  admin_username: zUsername,
  admin_password: zPassword,
  admin_email: zOptEmail,
});

// ---------------------------------------------------------------------------
// Trust boundary — auth / OTP (services/supabaseAuth.ts)
// ---------------------------------------------------------------------------

export const CreateHospitalRpcSchema = z.object({
  name: zReqLine(200),
  region: zOptLine(120),
  contact_email: zOptEmail,
  contact_phone: zOptPhone,
  admin_full_name: zOptLine(120),
});

export const EmailOtpSchema = z.object({ email: zEmail });

export const VerifyOtpSchema = z.object({ email: zEmail, token: zOtpToken });

// ---------------------------------------------------------------------------
// Core service-layer mutators (services/mockStorage.ts)
// ---------------------------------------------------------------------------

/** Patient identity captured at intake (CreatePatientInput). `full_name` stays
 *  permissive (empty allowed) because emergency/anonymous intake supplies none —
 *  required-ness is enforced by the form. */
export const CreatePatientInputSchema = z.object({
  full_name: zOptLine(120),
  date_of_birth: zOptIsoDate,
  sex: zSex.optional(),
  // Bounded text, NOT strict E.164: the intake form already enforces E.164 via
  // libphonenumber, but the data layer has always accepted display formats like
  // "+237 6 70 00 00 00". The cap + control-char guard is the security value here.
  phone: zOptLine(32),
  address: zOptLine(200),
  national_id: zOptLine(64),
  mother_first_name: zOptLine(80),
  is_emergency_anonymous: z.boolean().optional(),
  anonymous_identifier: zOptLine(64).optional(),
  // Phase 21 demographics — all optional at intake.
  occupation: zOptLine(120),
  marital_status: zMaritalStatus.optional(),
  emergency_contact_name: zOptLine(120),
  // Same bounded-text-not-strict-E.164 reasoning as `phone` above.
  emergency_contact_phone: zOptLine(32),
});

/** Visit/encounter opened at intake (CreateVisitInput). */
export const CreateVisitInputSchema = z.object({
  visit_type: zVisitType,
  department_id: zOptId,
  attending_doctor_id: zOptId,
  registered_by_id: zOptId,
  chief_complaint: zOptText(2000),
  triage_notes: zOptText(2000),
  triage_level: zTriageLevel,
  stage: zCareStage.optional(),
});

/** Lab/imaging result entry (AddResultInput). */
export const ResultEntrySchema = z.object({
  recorded_by_id: zOptId,
  summary: zOptText(2000),
  value: zOptText(2000),
  reference_range: zOptLine(200),
  is_abnormal: z.boolean().optional(),
  attachment_path: zOptLine(512),
});

/** Medication administration (RecordAdministrationInput). `held` / `refused` /
 *  `suspended` must carry a documented reason (in `notes`); `given` / `missed`
 *  do not. */
export const MedAdminSchema = z
  .object({
    administered_by_id: zOptId,
    status: zMarStatus,
    scheduled_for: z.string().nullish(),
    administered_at: z.string().nullish(),
    notes: zOptText(1000),
  })
  .refine(
    (v) =>
      !MAR_REASON_REQUIRED.includes(v.status) ||
      (typeof v.notes === "string" && v.notes.trim().length > 0),
    { message: "A reason is required for this status.", path: ["notes"] },
  );

/**
 * Bedside vitals (AddTreatmentLogInput). Ranges are deliberately wide — wide
 * enough that any *plausible real measurement* passes (incl. extreme but real
 * hypo/hyperthermia, tachy/bradycardia) — because the service layer must never
 * silently reject and lose a clinical observation. They exist only to catch
 * obvious garbage (e.g. a mis-typed 5-digit number); the UI surfaces a friendly
 * error if a value is rejected, so nothing is ever lost without the nurse knowing.
 */
export const VitalsSchema = z.object({
  recorded_by_id: zOptId,
  spo2: zOptNumber(0, 100),
  pulse: zOptNumber(0, 500),
  bp_systolic: zOptNumber(0, 500),
  bp_diastolic: zOptNumber(0, 500),
  temperature_c: zOptNumber(10, 46),
  weight_kg: zOptNumber(0, 700),
  gcs_score: zOptNumber(3, 15),
  notes: zOptText(2000),
  recorded_at: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Phase 21 — patient background (patient_history) & Review of Systems
// ---------------------------------------------------------------------------

/**
 * The documented `detail` jsonb shape per history type. Types not listed carry
 * no structured detail (detail must be null/absent). Strict objects: unknown
 * keys are rejected, so a tampered client can't smuggle arbitrary jsonb.
 */
export const HISTORY_DETAIL_SHAPES = {
  social: z
    .object({
      tobacco_pack_years: zOptNumber(0, 200),
      alcohol: zOptLine(120),
      drugs: zOptLine(120),
    })
    .strict(),
  obstetric_gynae: z
    .object({
      gravida: zOptNumber(0, 30),
      para: zOptNumber(0, 30),
      lmp: zOptIsoDate,
    })
    .strict(),
  family: z
    .object({
      relation: zOptLine(80),
      condition: zOptLine(200),
    })
    .strict(),
} as const;

/** Patient-level clinical background record (AddPatientHistoryInput). */
export const AddPatientHistoryInputSchema = z
  .object({
    type: zPatientHistoryType,
    description: zReqLine(300),
    detail: z.record(z.string(), z.unknown()).nullish(),
    onset: zOptLine(80),
    is_active: z.boolean().nullish(),
    noted_by_id: zOptId,
  })
  .superRefine((v, ctx) => {
    if (v.detail == null) return;
    const shape =
      HISTORY_DETAIL_SHAPES[v.type as keyof typeof HISTORY_DETAIL_SHAPES];
    if (!shape) {
      ctx.addIssue({
        code: "custom",
        path: ["detail"],
        message: `History type "${v.type}" does not carry structured detail.`,
      });
      return;
    }
    const result = shape.safeParse(v.detail);
    if (!result.success) {
      ctx.addIssue({
        code: "custom",
        path: ["detail"],
        message: result.error.issues[0]?.message ?? "Invalid detail shape.",
      });
    }
  });

/** `answer_value` shape per `answer_type` (second wall behind RLS — a tampered
 *  client can't store malformed jsonb). Option-membership and known-key checks
 *  live in apps/web `lib/ros`, beside the question bank. */
const ROS_ANSWER_VALUE_BY_TYPE = {
  boolean: z.boolean(),
  single_select: zReqLine(80),
  multi_select: z.array(zReqLine(80)).max(24),
  scale: zReqLine(80),
  duration: z
    .object({ value: z.number().gte(0).lte(100000), unit: zReqLine(24).optional() })
    .strict(),
  numeric: z
    .object({ value: z.number().gte(-1e9).lte(1e9), unit: zReqLine(24).optional() })
    .strict(),
  date: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date."),
  // Required bounded free text (newlines allowed, NUL rejected).
  text: z
    .string()
    .max(2000)
    .refine((v) => v.trim().length > 0 && !v.includes("\x00")),
} as const;

/** One answered ROS question, upserted per (visit, question_key) (UpsertRosInput). */
export const UpsertRosInputSchema = z
  .object({
    system: zBodySystem,
    question_key: zReqLine(160),
    kind: zRosQuestionKind,
    question_text: zReqLine(300),
    answer_type: zRosAnswerType,
    answer_value: z.unknown(),
    answer_label: zReqLine(300),
    note: zOptText(1000),
    recorded_by_id: zOptId,
  })
  .superRefine((v, ctx) => {
    const shape = ROS_ANSWER_VALUE_BY_TYPE[v.answer_type];
    const result = shape.safeParse(v.answer_value);
    if (!result.success) {
      ctx.addIssue({
        code: "custom",
        path: ["answer_value"],
        message: `Answer value does not match answer type "${v.answer_type}".`,
      });
    }
  });
