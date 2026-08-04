/**
 * Deterministic safety checks (Phase 22, spec §9).
 *
 * Runs SERVER-SIDE after the model responds, independently of anything the
 * model said about allergies — the model's own judgement can never clear a
 * recorded allergy. Flags produced here carry `source: "allergy_check"` and
 * `critical` ones render as a blocking banner the doctor must acknowledge
 * before prescribing.
 *
 * v1 scope: allergy ↔ suggested-drug matching via case-insensitive substring
 * plus a small drug-class synonym map (extendable). Drug–drug interaction
 * checking is a stub, structured so a dataset/API can plug in later.
 */

import type { AiSafetyFlag, PatientContext, ResultsSuggestion } from "@careflow/shared/types/ai";

/**
 * Drug-class groups: an allergy naming ANY member (or the group itself)
 * flags a suggested drug that is any other member of the same group.
 * Lowercase; matching is substring-based on normalized names.
 */
const DRUG_CLASS_GROUPS: Record<string, string[]> = {
  penicillins: [
    "penicillin",
    "benzylpenicillin",
    "amoxicillin",
    "amoxicillin-clavulanate",
    "amoxiclav",
    "co-amoxiclav",
    "augmentin",
    "ampicillin",
    "flucloxacillin",
    "cloxacillin",
    "piperacillin",
  ],
  cephalosporins: [
    "cephalosporin",
    "cefalexin",
    "cephalexin",
    "cefuroxime",
    "ceftriaxone",
    "cefixime",
    "cefotaxime",
  ],
  sulfonamides: [
    "sulfa",
    "sulfonamide",
    "sulfamethoxazole",
    "co-trimoxazole",
    "cotrimoxazole",
    "bactrim",
    "sulfadoxine",
  ],
  nsaids: [
    "nsaid",
    "aspirin",
    "acetylsalicylic",
    "ibuprofen",
    "diclofenac",
    "naproxen",
    "ketorolac",
  ],
  opioids: ["opioid", "codeine", "morphine", "tramadol", "pethidine"],
};

const normalize = (s: string): string => s.toLowerCase().trim();

/** Groups a normalized substance/drug name belongs to (substring matching). */
function groupsOf(name: string): string[] {
  const n = normalize(name);
  if (!n) return [];
  const hits: string[] = [];
  for (const [group, members] of Object.entries(DRUG_CLASS_GROUPS)) {
    if (members.some((m) => n.includes(m) || m.includes(n))) hits.push(group);
  }
  return hits;
}

/**
 * Cross-check suggested drugs against recorded allergies. Returns `critical`
 * flags for direct or same-class matches.
 */
export function checkAllergies(
  medications: Pick<ResultsSuggestion["medications"][number], "drugName">[],
  allergies: PatientContext["allergies"],
): AiSafetyFlag[] {
  const flags: AiSafetyFlag[] = [];

  for (const med of medications) {
    const drug = normalize(med.drugName);
    if (!drug) continue;
    const drugGroups = groupsOf(drug);

    for (const allergy of allergies) {
      const substance = normalize(allergy.substance);
      if (!substance) continue;

      const directHit = drug.includes(substance) || substance.includes(drug);
      const classHit = groupsOf(substance).some((g) => drugGroups.includes(g));

      if (directHit || classHit) {
        flags.push({
          severity: "critical",
          message: `${med.drugName} conflicts with the recorded allergy "${allergy.substance}"${
            allergy.reaction ? ` (${allergy.reaction})` : ""
          }.`,
          source: "allergy_check",
        });
        break; // one flag per suggested drug is enough
      }
    }
  }

  return flags;
}

/**
 * Drug–drug interaction check — v2 stub (spec §19). Shape is final so a
 * dataset/API can plug in without touching callers.
 */
export function checkInteractions(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _medications: Pick<ResultsSuggestion["medications"][number], "drugName">[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _current: PatientContext["currentMedications"],
): AiSafetyFlag[] {
  return [];
}
