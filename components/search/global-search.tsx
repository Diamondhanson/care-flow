"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Search, User, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/components/locale-provider";
import {
  searchPatients,
  getLatestVisitForPatient,
} from "@/services/mockStorage";
import { VISIT_TYPE_LABEL } from "@/components/reports/reports";
import { PatientDrawer } from "@/components/live-board/patient-drawer";
import type { Patient, Visit } from "@/types/healthcare";

interface ResultRow {
  patient: Patient;
  visit: Visit | undefined;
}

export function GlobalSearch() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [visitId, setVisitId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K opens the search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset the query each time the dialog closes.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const results: ResultRow[] = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return searchPatients(trimmed).map((patient) => ({
      patient,
      visit: getLatestVisitForPatient(patient.id),
    }));
  }, [query]);

  const trimmed = query.trim();

  function openPatient(row: ResultRow) {
    if (!row.visit) return;
    setVisitId(row.visit.id);
    setOpen(false);
    setDrawerOpen(true);
  }

  return (
    <>
      {/* Pinned trigger — wide search box on desktop, icon on mobile. */}
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={t("search.trigger")}
        className="size-9 justify-center p-0 text-muted-foreground sm:h-9 sm:w-64 sm:justify-start sm:gap-2 sm:px-3"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden flex-1 text-left text-sm font-normal sm:inline">
          {t("search.trigger")}
        </span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </Button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs" />
          <Dialog.Popup
            initialFocus={inputRef}
            className="fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl transition duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:scale-98 data-starting-style:scale-98"
          >
            <Dialog.Title className="sr-only">
              {t("search.title")}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {t("search.description")}
            </Dialog.Description>

            {/* Search input */}
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search.placeholder")}
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoComplete="off"
                spellCheck={false}
              />
              <Dialog.Close
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} />
                }
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>

            {/* Results */}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {!trimmed ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t("search.typeToSearch")}
                </p>
              ) : results.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t("search.noResults", { query: trimmed })}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {results.map((row) => {
                    const { patient, visit } = row;
                    const hasVisit = visit !== undefined;
                    return (
                      <li key={patient.id}>
                        <button
                          type="button"
                          disabled={!hasVisit}
                          onClick={() => openPatient(row)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                            hasVisit
                              ? "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                              : "cursor-not-allowed opacity-60",
                          )}
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                            <User className="size-4" />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col leading-tight">
                            <span className="truncate text-sm font-medium">
                              {patient.is_emergency_anonymous &&
                              patient.anonymous_identifier
                                ? patient.anonymous_identifier
                                : patient.full_name}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              <span className="font-mono">{patient.mrn}</span>
                              {patient.phone ? ` · ${patient.phone}` : ""}
                            </span>
                          </span>
                          {hasVisit ? (
                            <Badge
                              variant={
                                visit.status === "open" ? "default" : "secondary"
                              }
                              className="shrink-0 text-[10px]"
                            >
                              {t(VISIT_TYPE_LABEL[visit.visit_type])}
                            </Badge>
                          ) : (
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {t("search.noVisit")}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <PatientDrawer
        visitId={visitId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onMutate={() => {}}
      />
    </>
  );
}
