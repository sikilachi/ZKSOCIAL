import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cors, setStatus, tg } from "../_shared/lib.ts";

const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Only a signed-in admin may call this.
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: ok } = await user.rpc("is_admin");
  if (ok !== true) return out({ error: "Not allowed" }, 403);
  const { id, status, test } = await req.json();
  if (test) { const sent = await tg("✅ ZKSocial test notification"); return out({ ok: sent }, sent ? 200 : 400); }
  if (!["paid", "completed", "cancelled"].includes(status)) return out({ error: "Bad status" }, 400);
  const o = await setStatus(id, status);
  return out({ ok: !!o }, o ? 200 : 409);
});
