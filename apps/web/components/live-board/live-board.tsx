"use client";

import { useEffect, useState } from "react";

import { ALL_DEPARTMENTS, getDepartments } from "@/services/mockStorage";
import { StageCounts } from "@/components/live-board/stage-counts";
import { JourneyBoard } from "@/components/live-board/journey-board";
import type { Department } from "@/types/healthcare";

export function LiveBoard() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string>(ALL_DEPARTMENTS);

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
