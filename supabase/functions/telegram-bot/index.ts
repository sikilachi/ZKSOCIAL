import { sb, setStatus, code, esc } from "../_shared/lib.ts";

const api = (m: string, body: unknown) => fetch(`https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const line = (o: any) => `#${code(o.id)} · ${esc(o.pf)} ${esc(o.name)} ×${o.qty} · €${Number(o.amount).toFixed(2)} · ${o.status.replace("_", " ")}`;

Deno.serve(async (req) => {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== Deno.env.get("TELEGRAM_SECRET")) return new Response("no", { status: 401 });
  const u = await req.json(), msg = u.message, cb = u.callback_query;
  const chat = String((msg ?? cb?.message)?.chat?.id ?? "");
  const text: string = msg?.text ?? "";
  if (text.startsWith("/start")) { await api("sendMessage", { chat_id: chat, text: `Your chat ID: ${chat}\nSet it as the TELEGRAM_CHAT_ID secret.` }); return new Response("ok"); }
  if (chat !== Deno.env.get("TELEGRAM_CHAT_ID")) return new Response("ok"); // ignore everyone except the owner

  if (cb) { // button on a new-order message
    const [status, id] = String(cb.data).split(":");
    const o = ["paid", "completed", "cancelled"].includes(status) ? await setStatus(id, status as any) : null;
    await api("answerCallbackQuery", { callback_query_id: cb.id, text: o ? `Order ${status}` : "Already updated" });
    if (o) await api("editMessageText", { chat_id: chat, message_id: cb.message.message_id, parse_mode: "HTML", text: `${line(o)}\nMarked as <b>${status}</b>` });
    return new Response("ok");
  }
  if (text.startsWith("/orders") || text.startsWith("/pending")) {
    let q = sb.from("orders").select("*").order("created_at", { ascending: false }).limit(10);
    if (text.startsWith("/pending")) q = q.eq("status", "awaiting_payment");
    const { data } = await q;
    await api("sendMessage", { chat_id: chat, parse_mode: "HTML", text: data?.length ? data.map(line).join("\n") : "No orders." });
  }
  return new Response("ok");
});
