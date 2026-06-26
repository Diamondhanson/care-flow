import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CareFlow — Owner Console",
  description: "Cross-tenant platform owner console (Phase 19).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#0f172a",
          color: "#f8fafc",
        }}
      >
        {children}
      </body>
    </html>
  );
}
