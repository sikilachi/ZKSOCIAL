
import { sb, cors, paypalAccessToken, paypalBase, setStatus } from "../_shared/lib.ts";

const out = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { order_id, paypal_order_id } = await req.json();

    if (!order_id || !paypal_order_id)
      return out({ error: "Missing order identifiers." }, 400);

    const { data: order, error } = await sb
      .from("orders").select("*").eq("id", order_id).maybeSingle();

    if (error || !order) return out({ error: "Order not found." }, 404);

    if (["paid", "processing", "completed"].includes(order.status))
      return out({ ok: true, status: order.status, already_captured: true });

    if (order.paypal_order_id !== paypal_order_id)
      return out({ error: "PayPal order does not match." }, 400);

    const token = await paypalAccessToken();

    const get = await fetch(
      `${paypalBase()}/v2/checkout/orders/${encodeURIComponent(paypal_order_id)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const current = await get.json();

    if (!get.ok || current.status !== "APPROVED")
      return out({ error: "PayPal has not approved this payment yet." }, 409);

    const pu = current.purchase_units?.[0];
    const amt = pu?.amount;

    if (
      pu?.custom_id !== order_id ||
      amt?.currency_code !== "EUR" ||
      Number(amt?.value) !== Number(order.amount)
    ) return out({ error: "PayPal order details do not match." }, 400);

    const capture = await fetch(
      `${paypalBase()}/v2/checkout/orders/${encodeURIComponent(paypal_order_id)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `zksocial-capture-${order_id}`
        }
      }
    );

    const cj = await capture.json();

    if (!capture.ok && cj.status !== "COMPLETED")
      return out({ error: cj.message ?? "PayPal capture failed." }, 409);

    if (cj.status !== "COMPLETED")
      return out({ error: "PayPal has not completed the capture." }, 409);

    const payment = cj.purchase_units?.[0]?.payments?.captures?.[0];

    if (
      !payment?.id ||
      payment.amount?.currency_code !== "EUR" ||
      Number(payment.amount?.value) !== Number(order.amount)
    ) return out({ error: "Captured payment amount could not be verified." }, 400);

    await sb.from("orders").update({
      paypal_capture_id: payment.id,
      payment_status: "completed"
    }).eq("id", order_id);

    const updated = await setStatus(order_id, "paid");

    if (!updated) {
      const { data: latest } = await sb.from("orders")
        .select("status").eq("id", order_id).maybeSingle();

      return out({
        ok: ["paid", "processing", "completed"].includes(latest?.status),
        status: latest?.status
      });
    }

    return out({ ok: true, status: updated.status, capture_id: payment.id });

  } catch (e) {
    return out({ error: (e as Error).message }, 400);
  }
});
