
import {
  sb,
  cors,
  paypalAccessToken,
  paypalBase,
  setStatus
} from "../_shared/lib.ts";

const out = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: cors
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const event = await req.json();

    const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
    if (!webhookId) {
      return out({ error: "PAYPAL_WEBHOOK_ID is missing." }, 500);
    }

    const h = req.headers;
    const transmissionId = h.get("paypal-transmission-id");
    const transmissionTime = h.get("paypal-transmission-time");
    const certUrl = h.get("paypal-cert-url");
    const authAlgo = h.get("paypal-auth-algo");
    const transmissionSig = h.get("paypal-transmission-sig");

    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
      return out({ error: "Missing PayPal signature headers." }, 400);
    }

    const token = await paypalAccessToken();

    const verification = await fetch(
      `${paypalBase()}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          transmission_id: transmissionId,
          transmission_time: transmissionTime,
          cert_url: certUrl,
          auth_algo: authAlgo,
          transmission_sig: transmissionSig,
          webhook_id: webhookId,
          webhook_event: event
        })
      }
    );

    const verified = await verification.json();

    if (!verification.ok || verified.verification_status !== "SUCCESS") {
      return out({ error: "PayPal webhook signature verification failed." }, 401);
    }

    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return out({ received: true, ignored: event.event_type });
    }

    const capture = event.resource;
    const paypalOrderId =
      capture?.supplementary_data?.related_ids?.order_id;

    if (!paypalOrderId || !capture?.id) {
      return out({ error: "Missing PayPal order or capture ID." }, 400);
    }

    const { data: order, error } = await sb
      .from("orders")
      .select("*")
      .eq("paypal_order_id", paypalOrderId)
      .maybeSingle();

    if (error || !order) {
      return out({ error: "Matching ZKSocial order not found." }, 404);
    }

    if (
      capture.amount?.currency_code !== "EUR" ||
      Number(capture.amount?.value) !== Number(order.amount)
    ) {
      return out({ error: "Payment amount does not match the order." }, 400);
    }

    const latest = await fetch(
      `${paypalBase()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const paypalOrder = await latest.json();

    if (!latest.ok || paypalOrder.status !== "COMPLETED") {
      return out({ error: "PayPal order is not completed." }, 409);
    }

    await sb.from("orders").update({
      paypal_capture_id: capture.id,
      payment_status: "completed"
    }).eq("id", order.id);

    if (["awaiting_payment"].includes(order.status)) {
      await setStatus(order.id, "paid");
    }

    return out({ received: true, paid: true });
  } catch (error) {
    return out({ error: (error as Error).message }, 400);
  }
});
