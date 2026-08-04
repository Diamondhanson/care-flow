/**
 * Notifications — the who-notifies-whom seam (in-app bell + Web Push).
 *
 * Producers (the domain mutators) call {@link queueNotifications} with rows
 * addressed to OTHER staff, pushing them onto the open `db.notifications`
 * snapshot. Because that happens BEFORE `persist(db)`, the engine's row-diff
 * captures each one and the outbox uploads it exactly like clinical data — no
 * separate transport. Supabase Realtime then streams the insert to its
 * recipient's tab (see services/notifications-client.ts), and the send-push
 * Edge Function delivers Web Push when their app is closed. The engine's
 * persist() fires NOTIFICATIONS_EVENT whenever notification rows change (see
 * db/engine.ts), so the bell's store stays live.
 *
 * Rules baked in here: never notify the actor themselves, de-dupe recipients,
 * and store STRUCTURED data + English fallback copy (the bell localises from
 * `type` + `data`; Web Push, built server-side, uses `title`/`body`).
 */

import type {
  Admission,
  DepartmentId,
  Notification,
  NotificationId,
  NotificationType,
  Patient,
  PatientId,
  Staff,
  StaffId,
  StaffRole,
  Visit,
} from "@careflow/shared";
import { generateId, nowISO, type Database } from "./shared";
import { emitNotificationsChanged, loadDatabase, persist } from "./engine";
import { loadScoped, tenantId } from "./tenancy";
import { isNotificationTypeEnabled } from "@/services/notification-prefs";

/** Resolved display name for a staff id (denormalised onto the row). */
function staffDisplayName(db: Database, id: StaffId | null | undefined): string | null {
  if (!id) return null;
  return db.staff.find((s) => s.id === id)?.full_name ?? null;
}

/** Patient's human label — the anonymous identifier for unidentified records. */
export function patientDisplayName(patient: Patient | undefined): string | null {
  if (!patient) return null;
  return patient.is_emergency_anonymous
    ? patient.anonymous_identifier ?? "Unidentified patient"
    : patient.full_name;
}

/** Active staff members holding any of the given roles (whole hospital). */
function activeStaffByRole(db: Database, roles: readonly StaffRole[]): Staff[] {
  return db.staff.filter((s) => s.is_active && roles.includes(s.role));
}

/**
 * Nurses who should hear about a visit. There is no explicit patient→nurse
 * assignment, so we infer: nurses in the ward's department (for an admission),
 * else nurses in the visit's department, else — so a small ward with no
 * departmental nurse still gets alerted — every active nurse in the hospital.
 */
export function nurseIdsForVisit(
  db: Database,
  visit: Visit,
  admission?: Admission,
): StaffId[] {
  let departmentId: DepartmentId | null = visit.department_id ?? null;
  if (admission?.ward_id) {
    const ward = db.wards.find((w) => w.id === admission.ward_id);
    if (ward?.department_id) departmentId = ward.department_id;
  }
  const nurses = activeStaffByRole(db, ["nurse"]);
  const scoped = departmentId
    ? nurses.filter((s) => s.department_id === departmentId)
    : [];
  const chosen = scoped.length > 0 ? scoped : nurses;
  return chosen.map((s) => s.id);
}

/** All active staff ids holding a role — used for lab/pharmacy fan-out. */
export function staffIdsByRole(db: Database, roles: readonly StaffRole[]): StaffId[] {
  return activeStaffByRole(db, roles).map((s) => s.id);
}

export interface NotifySpec {
  type: NotificationType;
  /** The acting staff member (excluded from recipients; names the row). */
  actorId: StaffId | null | undefined;
  /** English fallback headline — also the Web Push title. */
  title: string;
  body?: string | null;
  entityType?: string | null;
  /** Usually the visit id — the bell opens the patient drawer from it. */
  entityId?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  link?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Build one notification row per distinct recipient and push them onto
 * `db.notifications` (the caller persists afterwards). Skips the actor and any
 * blank/duplicate recipient. Pure w.r.t. storage — only mutates the passed db.
 */
export function queueNotifications(
  db: Database,
  recipientIds: readonly (StaffId | null | undefined)[],
  spec: NotifySpec,
): void {
  // Hospital-wide per-event toggle (admin-set on /settings). Silenced at the
  // producer: no row → no bell, no realtime, no push, for every recipient.
  if (!isNotificationTypeEnabled(spec.type)) return;
  const actorId = spec.actorId ?? null;
  const actorName = staffDisplayName(db, actorId);
  const seen = new Set<string>();
  for (const rid of recipientIds) {
    if (!rid || rid === actorId || seen.has(rid)) continue;
    seen.add(rid);
    db.notifications.push({
      id: generateId() as NotificationId,
      hospital_id: tenantId(db),
      recipient_staff_id: rid,
      actor_staff_id: actorId,
      actor_name: actorName,
      type: spec.type,
      title: spec.title,
      body: spec.body ?? null,
      entity_type: spec.entityType ?? null,
      entity_id: spec.entityId ?? null,
      patient_id: (spec.patientId ?? null) as PatientId | null,
      patient_name: spec.patientName ?? null,
      link: spec.link ?? null,
      data: spec.data ?? {},
      read_at: null,
      created_at: nowISO(),
    });
  }
}

// ---- Notification reads + read-state (consumed by the bell) ----------------

/** This device's notifications for one staff member, newest first. */
export function getNotificationsForStaff(
  staffId: StaffId,
  limit = 50,
): Notification[] {
  return loadScoped()
    .notifications.filter((n) => n.recipient_staff_id === staffId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit);
}

/** Count of unread notifications for one staff member. */
export function getUnreadNotificationCount(staffId: StaffId): number {
  return loadScoped().notifications.filter(
    (n) => n.recipient_staff_id === staffId && n.read_at === null,
  ).length;
}

/** Stamp a single notification read (idempotent). Returns the updated row. */
export function markNotificationRead(id: string): Notification | undefined {
  const db = loadDatabase();
  const row = db.notifications.find((n) => n.id === id);
  if (!row || row.read_at !== null) return row;
  row.read_at = nowISO();
  persist(db);
  emitNotificationsChanged();
  return row;
}

/** Mark every unread notification for a staff member read. */
export function markAllNotificationsRead(staffId: StaffId): void {
  const db = loadDatabase();
  const ts = nowISO();
  let changed = false;
  for (const n of db.notifications) {
    if (n.recipient_staff_id === staffId && n.read_at === null) {
      n.read_at = ts;
      changed = true;
    }
  }
  if (!changed) return;
  persist(db);
  emitNotificationsChanged();
}
