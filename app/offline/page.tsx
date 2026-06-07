import Link from "next/link";
import { CloudOff } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Offline — CareFlow",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="flex flex-col items-center gap-4 py-10">
          <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CloudOff className="size-7" aria-hidden />
          </span>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              You&apos;re offline
            </h1>
            <p className="text-sm text-muted-foreground">
              This page hasn&apos;t been cached yet. Pages you&apos;ve already
              visited still work offline, and any changes you make are saved on
              this device and will sync once you&apos;re back online.
            </p>
          </div>
          <Link href="/dashboard" className={cn(buttonVariants({ variant: "default" }), "mt-1")}>
            Back to the board
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
