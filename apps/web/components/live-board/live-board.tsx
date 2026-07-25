"use client";

import { useEffect, useState } from "react";

import {
  ALL_DEPARTMENTS,
  getDepartments,
  type DepartmentFilter,
} from "@/services/mockStorage";
import { StageCounts } from "@/components/live-board/stage-counts";
import { JourneyBoard } from "@/components/live-board/journey-board";
import type { Department } from "@careflow/shared";

export function LiveBoard() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<DepartmentFilter>(ALL_DEPARTMENTS);

  useEffect(() => {
    setDepartments(getDepartments());
  }, []);

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
