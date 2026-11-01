
import {
  sb,
  cors,
  site,
  code,
  esc,
  tg,
  mail,
  paypalAccessToken,
  paypalBase
} from "../_shared/lib.ts";

const disc = (q: number) =>
  q >= 10000 ? 0.9 : q >= 5000 ? 0.95 : 1;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const { product_id, qty, premium, target, email } = await req.json();

    const { data: p } = await sb
      .from("products")
      .select("*")
      .eq("id", product_id)
      .eq("active", true)
      .maybeSingle();

    if (!p) throw new Error("Product not found.");

    const q = Math.floor(Number(qty));
    const tgt = String(target ?? "").trim().slice(0, 300);
    const em = String(email ?? "").trim();

    if (!(q >= p.a && q <= p.b)) {
      throw new Error("Invalid quantity.");
    }

    if (!/^\S+@\S+\.\S+$/.test(em) || tgt.length < 2) {
      throw new Error("Invalid details.");
    }

    const { data: s } = await sb
      .from("settings")
      .select("cfg")
      .eq("id", 1)
      .maybeSingle();

    const prem = premium
      ? 1 + Number(s?.cfg?.prem ?? 60) / 100
      : 1;

    const cents = Math.round(
      (q / 1000) * Number(p.r) * prem * disc(q) * 100
    );

    if (cents < 50) throw new Error("Amount too small.");

    const amount = (cents / 100).toFixed(2);

    const { data: o, error } = await sb
      .from("orders")
      .insert({
        product_id: p.id,
        pf: p.pf,
        name: p.n,
        target: tgt,
        qty: q,
        premium: !!premium,
        email: em,
        amount: cents / 100,
        status: "awaiting_payment",
        payment_status: "pending"
      })
      .select("id")
      .single();

    if (error || !o) throw error ?? new Error("Order creation failed.");

    const token = await paypalAccessToken();
    const base = site() || "https://zksocial-ten.vercel.app";

    const response = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `zksocial-${o.id}`
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: o.id,
          custom_id: o.id,
          invoice_id: `ZKS-${code(o.id)}`,
          description: `${p.pf} ${p.n} - ${q}`,
          amount: {
            currency_code: "EUR",
            value: amount
          }
        }],
        application_context: {
          brand_name: "ZKSocial",
          user_action: "PAY_NOW",
          return_url: `${base}/?paypal=success&order_id=${o.id}`,
          cancel_url: `${base}/?paypal=cancel&order_id=${o.id}`
        }
      })
    });

    const paypal = await response.json();

    if (!response.ok || !paypal.id) {
      await sb.from("orders").update({
        status: "failed",
        payment_status: "failed",
        note: "PayPal order creation failed."
      }).eq("id", o.id);

      throw new Error(
        paypal.message || "Could not create PayPal checkout."
      );
    }

    const approval = paypal.links?.find(
      (link: { rel: string; href: string }) => link.rel === "approve"
    );

    if (!approval?.href) {
      throw new Error("PayPal approval URL missing.");
    }

    const { error: updateError } = await sb
      .from("orders")
      .update({ paypal_order_id: paypal.id })
      .eq("id", o.id);

    if (updateError) throw updateError;

    const orderCode = code(o.id);
    const track = `${base}/?track=${o.id}#track`;

    const details =
      `${q.toLocaleString("en-US")} ${esc(p.pf)} ${esc(p.n)} for ${esc(tgt)} · €${amount}`;

    await Promise.allSettled([
      mail(
        em,
        `Order #${orderCode} received`,
        `<p>Thanks for your order!</p>
        <p>${details}</p>
        <p><a href="${approval.href}"><b>Pay securely with PayPal</b></a></p>
        <p><a href="${track}">Track your order</a></p>`
      ),
      tg(
        `🆕 <b>New order #${orderCode}</b>\n${details}\n${esc(em)}\nAwaiting PayPal payment.`,
        [["View order", `paid:${o.id}`]]
      )
    ]);

    return new Response(
      JSON.stringify({
        id: o.id,
        url: approval.href,
        amount: cents / 100,
        paypal_order_id: paypal.id
      }),
      { headers: cors }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 400, headers: cors }
    );
  }
});
