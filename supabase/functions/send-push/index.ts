// deno-lint-ignore-file no-explicit-any
/**
 * send-push — CareFlow Web Push fan-out.
 *
 * Triggered by a Supabase Database Webhook on INSERT into `public.notifications`
 * (configure it to POST here). For the inserted row, look up the recipient's
 * `push_subscriptions` and deliver a Web Push to each device. Expired endpoints
 * (404/410) are pruned so a device never accumulates dead subscriptions.
 *
 * Runs with the SERVICE ROLE so it can read push_subscriptions across the
 * recipient's rows (RLS is scoped to the current user; this job has no user).
 *
 * Required Function secrets (supabase secrets set …):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (injected automatically)
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:ops@hospital)
 */

import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:ops@careflow.app";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface NotificationRow {
  id: string;
  recipient_staff_id: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // Database Webhook shape: { type: 'INSERT', record: {...} }. Accept a bare
    // row too, for manual invocation / testing.
    const row: NotificationRow = payload.record ?? payload;
    if (!row?.recipient_staff_id) {
      return new Response("no recipient", { status: 400 });
    }

    const { data: subs, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("staff_id", row.recipient_staff_id);
    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response("no subscriptions", { status: 200 });
    }

    const message = JSON.stringify({
      title: row.title,
      body: row.body ?? "",
      tag: row.id,
      link: row.link ?? "/",
      entity_type: row.entity_type,
      entity_id: row.entity_id,
    });

    const expired: string[] = [];
    await Promise.all(
      subs.map(async (s: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            message,
          );
        } catch (err: any) {
          const status = err?.statusCode;
          if (status === 404 || status === 410) expired.push(s.id);
        }
      }),
    );

    if (expired.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", expired);
    }

    return new Response(
      JSON.stringify({ sent: subs.length - expired.length, pruned: expired.length }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    return new Response(`send-push error: ${err}`, { status: 500 });
  }
});
