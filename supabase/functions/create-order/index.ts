import { sb, cors, site, code, esc, tg, mail, payUrl } from "../_shared/lib.ts";

const disc = (q: number) => (q >= 10000 ? 0.9 : q >= 5000 ? 0.95 : 1);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { product_id, qty, premium, target, email } = await req.json();
    const { data: p } = await sb.from("products").select("*").eq("id", product_id).eq("active", true).maybeSingle();
    if (!p) throw new Error("Product not found. Open /#admin and press Save once.");
    const q = Math.floor(Number(qty)), tgt = String(target).trim().slice(0, 300), em = String(email).trim();
    if (!(q >= p.a && q <= p.b)) throw new Error("Invalid quantity");
    if (!/^\S+@\S+\.\S+$/.test(em) || tgt.length < 2) throw new Error("Invalid details");
    // The price is always recalculated here, never trusted from the browser.
    const { data: s } = await sb.from("settings").select("cfg").eq("id", 1).maybeSingle();
    const prem = premium ? 1 + Number(s?.cfg?.prem ?? 60) / 100 : 1;
    const cents = Math.round((q / 1000) * Number(p.r) * prem * disc(q) * 100);
    if (cents < 50) throw new Error("Amount too small");
    const { data: o, error } = await sb.from("orders").insert({ product_id: p.id, pf: p.pf, name: p.n, target: tgt, qty: q, premium: !!premium, email: em, amount: cents / 100 }).select("id").single();
    if (error) throw error;
    const url = await payUrl(cents / 100), c = code(o.id), track = `${site()}/?track=${o.id}#track`;
    const det = `${q.toLocaleString("en-US")} ${esc(p.pf)} ${esc(p.n)} for ${esc(tgt)} · €${(cents / 100).toFixed(2)}`;
    await Promise.allSettled([
      mail(em, `Order #${c} received`, `<p>Thanks for your order!</p><p>${det}</p>` + (url ? `<p><a href="${url}"><b>Pay with PayPal</b></a><br>Please add your order code <b>${c}</b> in the PayPal note.</p>` : "<p>We will send you your PayPal payment link shortly.</p>") + `<p><a href="${track}">Track your order</a></p>`),
      tg(`🆕 <b>New order #${c}</b>\n${det}\n${esc(em)}\n` + (url ? "" : "⚠️ No PayPal.me username set. Send the payment link manually.\n") + "Awaiting payment", [["✅ Paid", `paid:${o.id}`], ["✖ Cancel", `cancelled:${o.id}`]]),
    ]);
    return new Response(JSON.stringify({ id: o.id, url, amount: cents / 100 }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: cors });
  }
});
