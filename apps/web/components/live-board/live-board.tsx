"use client";

import { useEffect, useState } from "react";

import {
  ALL_DEPARTMENTS,
  getDepartments,
  type DepartmentFilter,
} from "@/services/mockStorage";
import { StageCounts } from "@/components/live-board/stage-counts";
import { JourneyBoard } from "@/components/live-board/journey-board";
import { useCacheVersion } from "@/lib/use-cache";
import type { Department } from "@careflow/shared";

export function LiveBoard() {
  const cacheVersion = useCacheVersion();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<DepartmentFilter>(ALL_DEPARTMENTS);

  useEffect(() => {
    setDepartments(getDepartments());
  }, [cacheVersion]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <StageCounts
        departmentId={departmentId}
        departments={departments}
        onDepartmentChange={setDepartmentId}
      />
      <JourneyBoard departmentId={departmentId} />
    </div>
  );
}
