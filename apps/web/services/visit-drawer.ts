/**
 * A tiny app-wide bus for opening the patient drawer by visit id from anywhere.
 *
 * The drawer has no URL of its own — it is component state owned by the
 * app-wide {@link GlobalSearch} in the navbar. Rather than thread that state
 * through the tree, a notification click (or any other deep link) dispatches
 * `careflow:open-visit`; GlobalSearch listens and opens its already-mounted
 * PatientDrawer. Browser-only and side-effect-free to import.
 */

export const OPEN_VISIT_EVENT = "careflow:open-visit";

/** Ask the app-wide patient drawer to open on a given visit. */
export function openVisitDrawer(visitId: string): void {
  if (typeof window === "undefined" || !visitId) return;
  window.dispatchEvent(new CustomEvent(OPEN_VISIT_EVENT, { detail: { visitId } }));
}
