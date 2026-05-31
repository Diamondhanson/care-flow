import { StageCounts } from "@/components/live-board/stage-counts";
import { JourneyBoard } from "@/components/live-board/journey-board";

export default function Home() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <StageCounts />
      <JourneyBoard />
    </div>
  );
}
