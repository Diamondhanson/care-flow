/**
 * Hospital structure — hospital accounts (control-plane), departments,
 * wards & beds (admin floor map), staff, and ward occupancy.
 */

import type {
  AuthUserId,
  Bed,
  BedId,
  BedStatus,
  Department,
  DepartmentId,
  Hospital,
  HospitalId,
  Staff,
  StaffId,
  StaffRole,
  SubscriptionStatus,
  Ward,
  WardId,
} from "@/types/healthcare";
import { generateId, nowISO } from "./shared";
import { loadDatabase, persist } from "./engine";
import { currentHospitalId, loadScoped, tenantId } from "./tenancy";

/**
 * Public resolver for the active tenant's hospital record (the account row).
 * Returns undefined only when the store somehow holds no hospitals.
 */
export function getCurrentHospital(): Hospital | undefined {
  const db = loadDatabase();
  const hid = currentHospitalId(db);
  return db.hospitals.find((h) => h.id === hid);
}

/**
 * Every hospital account known to the platform. Deliberately NOT tenant-scoped:
 * this is the control-plane view (signup, the dev hospital switcher, a future
 * super-admin console), the one place that legitimately sees across tenants. On
 * the Supabase cutover this maps to a service-role / platform query, not an
 * RLS-scoped one.
 */
export function getHospitals(): Hospital[] {
  return loadDatabase().hospitals;
}

/** A single hospital account by id, or undefined. Control-plane (cross-tenant). */
export function getHospitalById(id: HospitalId): Hospital | undefined {
  return loadDatabase().hospitals.find((h) => h.id === id);
}

/**
 * Register a new hospital account — the heart of the future signup flow. New
 * tenants start on a `trial` subscription. The created hospital is returned so
 * the caller can immediately make it the active tenant and seed its first staff.
 */
export function createHospital(input: CreateHospitalInput): Hospital {
  const db = loadDatabase();
  const timestamp = nowISO();
  const hospital: Hospital = {
    id: generateId() as HospitalId,
    name: input.name.trim(),
    region: input.region?.trim() || null,
    contact_email: input.contact_email?.trim() || null,
    contact_phone: input.contact_phone?.trim() || null,
    subscription_tier: input.subscription_tier ?? "standard",
    subscription_status: input.subscription_status ?? "trial",
    created_at: timestamp,
    updated_at: timestamp,
  };
  if (!hospital.name) {
    throw new Error("createHospital: a hospital name is required");
  }
  db.hospitals.push(hospital);
  persist(db);
  return hospital;
}

export interface CreateHospitalInput {
  name: string;
  region?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  /** Defaults to "standard". */
  subscription_tier?: string;
  /** Defaults to "trial" for a fresh signup. */
  subscription_status?: SubscriptionStatus;
}

export interface CreateStaffInput {
  full_name: string;
  role: StaffRole;
  email?: string | null;
  phone?: string | null;
  department_id?: DepartmentId | null;
  /** Defaults to the active tenant; pass explicitly when seeding a new hospital. */
  hospital_id?: HospitalId;
}

export interface CreateDepartmentInput {
  name: string;
  code?: string | null;
  description?: string | null;
}

export interface UpdateDepartmentInput {
  name?: string;
  code?: string | null;
  description?: string | null;
  is_active?: boolean;
}

export interface CreateWardInput {
  name: string;
  department_id?: DepartmentId | null;
  block?: string | null;
  floor_label?: string | null;
  /** Optionally seed the ward with N sequentially-labelled beds on creation. */
  bed_count?: number;
}

export interface UpdateWardInput {
  name?: string;
  department_id?: DepartmentId | null;
  block?: string | null;
  floor_label?: string | null;
  is_active?: boolean;
}

export interface UpdateBedInput {
  label?: string;
  status?: BedStatus;
}

// ---------------------------------------------------------------------------
// Read queries — reference / structural
// ---------------------------------------------------------------------------

export function getDepartments(): Department[] {
  return loadScoped().departments;
}

export function getDepartmentById(id: DepartmentId): Department | undefined {
  return loadScoped().departments.find((d) => d.id === id);
}

export function getWards(): Ward[] {
  return loadScoped().wards;
}

export function getWardById(id: WardId): Ward | undefined {
  return loadScoped().wards.find((w) => w.id === id);
}

export function getBeds(): Bed[] {
  return loadScoped().beds;
}

export function getBedById(id: BedId): Bed | undefined {
  return loadScoped().beds.find((b) => b.id === id);
}

// ---------------------------------------------------------------------------
// Read queries — people
// ---------------------------------------------------------------------------

export function getStaff(): Staff[] {
  return loadScoped().staff;
}

export function getStaffById(id: StaffId): Staff | undefined {
  return loadScoped().staff.find((s) => s.id === id);
}

// --- Control-plane staff lookups (cross-tenant) -----------------------------
// The login screen and session resolution legitimately need to see staff before
// a tenant is active (you pick a hospital, then sign in). These read the FULL
// store, deliberately NOT scoped — the mock equivalent of a service-role query.

/** Every staff member of a given hospital — for the login "sign in as" picker. */
export function getStaffForHospital(hospitalId: HospitalId): Staff[] {
  return loadDatabase().staff.filter((s) => s.hospital_id === hospitalId);
}

/** Resolve a staff account by id across all tenants — used to restore a session. */
export function getStaffAccountById(id: StaffId): Staff | undefined {
  return loadDatabase().staff.find((s) => s.id === id);
}

/**
 * Resolve a staff account by its linked Supabase Auth uid (Phase 18b). After
 * hydration the staff row carries the real `user_id`, so this maps a signed-in
 * user straight to their staff identity without the mock metadata bridge.
 */
export function getStaffAccountByUserId(userId: string): Staff | undefined {
  return loadDatabase().staff.find((s) => s.user_id === userId);
}

/**
 * Create a staff member. Used by hospital signup (the founder admin, against the
 * just-created hospital via an explicit `hospital_id`) and by admin provisioning
 * (against the active tenant). A real login (`user_id`) is provisioned later via
 * a privileged server function (Phase 18); mock staff start with `user_id: null`.
 */
export function createStaff(input: CreateStaffInput): Staff {
  const db = loadDatabase();
  const fullName = input.full_name.trim();
  if (!fullName) {
    throw new Error("createStaff: a staff name is required");
  }
  const timestamp = nowISO();
  const staff: Staff = {
    id: generateId() as StaffId,
    hospital_id: input.hospital_id ?? tenantId(db),
    user_id: null,
    full_name: fullName,
    role: input.role,
    department_id: input.department_id ?? null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    is_active: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.staff.push(staff);
  persist(db);
  return staff;
}

export interface UpdateStaffInput {
  full_name?: string;
  role?: StaffRole;
  department_id?: DepartmentId | null;
  email?: string | null;
  phone?: string | null;
  is_active?: boolean;
}

/**
 * Edit a staff member's directory details or toggle their active flag (Stage 5
 * — staff management was previously add-only). Deactivation is the soft path
 * for departures: the row (and its history) stays, the account is flagged.
 */
export function updateStaff(id: StaffId, patch: UpdateStaffInput): Staff {
  const db = loadDatabase();
  const staff = db.staff.find((s) => s.id === id);
  if (!staff) {
    throw new Error(`updateStaff: staff "${id}" not found`);
  }
  if (patch.full_name !== undefined) {
    const name = patch.full_name.trim();
    if (!name) throw new Error("updateStaff: a staff name is required");
    staff.full_name = name;
  }
  if (patch.role !== undefined) staff.role = patch.role;
  if (patch.department_id !== undefined) staff.department_id = patch.department_id;
  if (patch.email !== undefined) staff.email = patch.email?.trim() || null;
  if (patch.phone !== undefined) staff.phone = patch.phone?.trim() || null;
  if (patch.is_active !== undefined) staff.is_active = patch.is_active;
  staff.updated_at = nowISO();
  persist(db);
  return staff;
}

/**
 * Remove a staff member. Used to roll back a freshly created mock staff row when
 * the privileged login provisioning (Phase 18a server action) fails — so the
 * directory never shows an account that has no real login behind it.
 */
export function deleteStaff(id: StaffId): void {
  const db = loadDatabase();
  const next = db.staff.filter((s) => s.id !== id);
  if (next.length === db.staff.length) return;
  db.staff = next;
  persist(db);
}

/**
 * Link a staff row to its Supabase Auth user id. Called right after
 * {@link provisionStaffLogin} succeeds (Phase 18b) so the new account's
 * `staff.user_id` matches `auth.uid()` — without that link the row is invisible
 * to its owner under Row-Level-Security. The write is tracked, so it drains to
 * Supabase via the outbox like any other mutation.
 */
export function setStaffUserId(id: StaffId, userId: string): void {
  const db = loadDatabase();
  const staff = db.staff.find((s) => s.id === id);
  if (!staff || staff.user_id === userId) return;
  // The auth uid enters from the (untyped) server-action boundary as a plain
  // string; brand it here where it lands on the typed row.
  staff.user_id = userId as AuthUserId;
  staff.updated_at = nowISO();
  persist(db);
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

export interface WardOccupancy {
  ward: Ward;
  total: number;
  occupied: number;
  free: number;
}

/** Per-ward bed occupancy, mirroring the `ward_occupancy` SQL view. Pure. */
export function computeWardOccupancy(wards: Ward[], beds: Bed[]): WardOccupancy[] {
  return wards.map((ward) => {
    const wardBeds = beds.filter((b) => b.ward_id === ward.id);
    const occupied = wardBeds.filter(
      (b) => b.status === "occupied" || b.status === "reserved"
    ).length;
    return {
      ward,
      total: wardBeds.length,
      occupied,
      free: wardBeds.length - occupied,
    };
  });
}

export function getWardOccupancy(): WardOccupancy[] {
  const db = loadScoped();
  return computeWardOccupancy(db.wards, db.beds);
}

// ---------------------------------------------------------------------------
// Mutations — departments (admin management)
// ---------------------------------------------------------------------------

/** Register a new department. Returns the created record. */
export function createDepartment(input: CreateDepartmentInput): Department {
  const db = loadDatabase();
  const timestamp = nowISO();
  const department: Department = {
    id: generateId() as DepartmentId,
    hospital_id: tenantId(db),
    name: input.name.trim(),
    code: input.code?.trim() || null,
    description: input.description?.trim() || null,
    is_active: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.departments.push(department);
  persist(db);
  return department;
}

/** Patch an existing department (name / code / description / active flag). */
export function updateDepartment(
  id: DepartmentId,
  patch: UpdateDepartmentInput
): Department {
  const db = loadDatabase();
  const department = db.departments.find((d) => d.id === id);
  if (!department) {
    throw new Error(`updateDepartment: department "${id}" not found`);
  }
  if (patch.name !== undefined) department.name = patch.name.trim();
  if (patch.code !== undefined) department.code = patch.code?.trim() || null;
  if (patch.description !== undefined)
    department.description = patch.description?.trim() || null;
  if (patch.is_active !== undefined) department.is_active = patch.is_active;
  department.updated_at = nowISO();
  persist(db);
  return department;
}

/** Toggle a department's active flag (soft archive — never hard-deleted). */
export function setDepartmentActive(
  id: DepartmentId,
  isActive: boolean
): Department {
  return updateDepartment(id, { is_active: isActive });
}

// ---------------------------------------------------------------------------
// Mutations — wards & beds (admin floor map)
// ---------------------------------------------------------------------------

/**
 * Next "Bed N" labels continuing past the highest existing numeric label, so
 * appended beds never collide. Private mirror of the UI's `nextBedLabels`.
 */
function nextBedLabelsInternal(existing: string[], count: number): string[] {
  let max = 0;
  for (const label of existing) {
    const m = label.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  const labels: string[] = [];
  for (let i = 1; i <= Math.max(0, Math.floor(count)); i++) {
    labels.push(`Bed ${max + i}`);
  }
  return labels;
}

function makeBed(
  wardId: WardId,
  label: string,
  timestamp: string,
  hospitalId: HospitalId,
): Bed {
  return {
    id: generateId() as BedId,
    hospital_id: hospitalId,
    ward_id: wardId,
    label,
    status: "free",
    current_admission_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/** Create a ward, optionally pre-filling it with `bed_count` free beds. */
export function createWard(input: CreateWardInput): Ward {
  const db = loadDatabase();
  const timestamp = nowISO();
  const ward: Ward = {
    id: generateId() as WardId,
    hospital_id: tenantId(db),
    department_id: input.department_id ?? null,
    name: input.name.trim(),
    block: input.block?.trim() || null,
    floor_label: input.floor_label?.trim() || null,
    is_active: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.wards.push(ward);

  for (const label of nextBedLabelsInternal([], input.bed_count ?? 0)) {
    db.beds.push(makeBed(ward.id, label, timestamp, ward.hospital_id));
  }

  persist(db);
  return ward;
}

/** Patch a ward (name / department / floor / active flag). */
export function updateWard(id: WardId, patch: UpdateWardInput): Ward {
  const db = loadDatabase();
  const ward = db.wards.find((w) => w.id === id);
  if (!ward) throw new Error(`updateWard: ward "${id}" not found`);
  if (patch.name !== undefined) ward.name = patch.name.trim();
  if (patch.department_id !== undefined) {
    ward.department_id = patch.department_id ?? null;
  }
  if (patch.block !== undefined) {
    ward.block = patch.block?.trim() || null;
  }
  if (patch.floor_label !== undefined) {
    ward.floor_label = patch.floor_label?.trim() || null;
  }
  if (patch.is_active !== undefined) ward.is_active = patch.is_active;
  ward.updated_at = nowISO();
  persist(db);
  return ward;
}

/** Soft-archive / restore a ward (never hard-deleted). */
export function setWardActive(id: WardId, isActive: boolean): Ward {
  return updateWard(id, { is_active: isActive });
}

/** Append `count` new free beds to a ward, continuing its numbering. */
export function addBedsToWard(wardId: WardId, count: number): Bed[] {
  const db = loadDatabase();
  const ward = db.wards.find((w) => w.id === wardId);
  if (!ward) throw new Error(`addBedsToWard: ward "${wardId}" not found`);
  const timestamp = nowISO();
  const existing = db.beds
    .filter((b) => b.ward_id === wardId)
    .map((b) => b.label);
  const created = nextBedLabelsInternal(existing, count).map((label) =>
    makeBed(wardId, label, timestamp, ward.hospital_id)
  );
  db.beds.push(...created);
  persist(db);
  return created;
}

/** Rename a bed or set a manual status (free / cleaning / maintenance / reserved). */
export function updateBed(bedId: BedId, patch: UpdateBedInput): Bed {
  const db = loadDatabase();
  const bed = db.beds.find((b) => b.id === bedId);
  if (!bed) throw new Error(`updateBed: bed "${bedId}" not found`);
  if (bed.current_admission_id && patch.status !== undefined) {
    throw new Error(
      "Cannot change the status of a bed that holds a patient — discharge or transfer first"
    );
  }
  if (patch.label !== undefined) bed.label = patch.label.trim();
  if (patch.status !== undefined) bed.status = patch.status;
  bed.updated_at = nowISO();
  persist(db);
  return bed;
}

/** Permanently remove a bed — only allowed when it holds no patient. */
export function removeBed(bedId: BedId): void {
  const db = loadDatabase();
  const bed = db.beds.find((b) => b.id === bedId);
  if (!bed) throw new Error(`removeBed: bed "${bedId}" not found`);
  if (bed.status === "occupied" || bed.current_admission_id) {
    throw new Error("Cannot remove a bed that holds a patient");
  }
  db.beds = db.beds.filter((b) => b.id !== bedId);
  persist(db);
}
