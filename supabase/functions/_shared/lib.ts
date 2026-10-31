import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Content-Type": "application/json" };
export const site = () => (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
export const code = (id: string) => id.slice(0, 8).toUpperCase();
const M: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => M[c]);

// Telegram message to the owner, optionally with inline buttons [label, callback_data].
export async function tg(text: string, buttons?: [string, string][]) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN"), chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chat) return false;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", reply_markup: buttons ? { inline_keyboard: [buttons.map(([t, d]) => ({ text: t, callback_data: d }))] } : undefined }),
  });
  return r.ok;
}

// Email through Resend. Skipped when RESEND_API_KEY is not set.
export async function mail(to: string, subject: string, html: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("MAIL_FROM") ?? "ZKSocial <onboarding@resend.dev>", to, subject, html }),
  });
}

// PayPal.me link with the amount filled in. The username is set in Admin > Payments.
export async function payUrl(amount: number) {
  const { data } = await sb.from("settings").select("cfg").eq("id", 1).maybeSingle();
  const me = data?.cfg?.paypal || Deno.env.get("PAYPAL_ME");
  return me ? `https://www.paypal.com/paypalme/${encodeURIComponent(me)}/${amount.toFixed(2)}EUR` : "";
}

// Usernames become profile links for the supplier API.
const link = (pf: string, t: string) => {
  const u = t.trim().replace(/^@/, "");
  if (/^https?:\/\//i.test(u) || u.includes("/")) return t.trim();
  const base: Record<string, string> = { instagram: "https://instagram.com/", tiktok: "https://tiktok.com/@", facebook: "https://facebook.com/" };
  return (base[pf.toLowerCase()] ?? "") + u;
};

// Sends a paid order to a supplier panel (standard SMM API: key, action=add, service, link, quantity).
// Without PROVIDER_API_URL/KEY or a supplier service ID the order stays "paid" for manual handling.
async function fulfil(o: any) {
  const { data: p } = await sb.from("products").select("provider_service").eq("id", o.product_id).maybeSingle();
  const url = Deno.env.get("PROVIDER_API_URL"), key = Deno.env.get("PROVIDER_API_KEY");
  if (!url || !key || !p?.provider_service) return;
  try {
    const r = await fetch(url, { method: "POST", body: new URLSearchParams({ key, action: "add", service: String(p.provider_service), link: link(o.pf, o.target), quantity: String(o.qty) }) });
    const j = await r.json();
    await sb.from("orders").update(j.order ? { status: "processing", provider_order: String(j.order) } : { status: "failed", note: String(j.error ?? "supplier error") }).eq("id", o.id);
  } catch (e) {
    await sb.from("orders").update({ status: "failed", note: String(e) }).eq("id", o.id);
  }
}

// One place for every status change (admin panel and Telegram buttons both use it).
export async function setStatus(id: string, status: "paid" | "completed" | "cancelled") {
  const from = status === "paid" ? ["awaiting_payment"] : status === "completed" ? ["paid", "processing"] : ["awaiting_payment", "paid", "processing"];
  const { data: o } = await sb.from("orders").update({ status }).eq("id", id).in("status", from).select("*").maybeSingle();
  if (!o) return null;
  const track = `${site()}/?track=${o.id}#track`;
  if (status === "paid") {
    await fulfil(o);
    await mail(o.email, `Payment received – order #${code(o.id)}`, `<p>Thanks! Your payment was received and your order has started.</p><p><a href="${track}">Track your order</a></p>`);
  } else if (status === "completed") {
    await mail(o.email, `Order #${code(o.id)} completed`, `<p>Your order is complete. Thank you!</p><p><a href="${track}">View your order</a></p>`);
  }
  return o;
}
