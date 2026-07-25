import { OfflineContent } from "./offline-content";

export const metadata = {
  title: "Offline — CareFlow",
};

/**
 * Server wrapper for the offline fallback (keeps the metadata export); the
 * visible copy lives in the client-side <OfflineContent /> so it can render in
 * the user's stored locale.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <OfflineContent />
    </div>
  );
}
