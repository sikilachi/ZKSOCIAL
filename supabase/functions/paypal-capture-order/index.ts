
import {
  sb,
  cors,
  paypalAccessToken,
  paypalBase,
  setStatus
} from "../_shared/lib.ts";

const headers = {
  ...cors,
  "Content-Type": "application/json",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const out = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers
  });

const toCents = (value: unknown): number => {
  const number = Number(value);

  if (!Number.isFinite(number)) return -1;

  return Math.round(number * 100);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return out({ error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json();

    const order_id = String(body.order_id ?? "").trim();
    const paypal_order_id = String(body.paypal_order_id ?? "").trim();

    // Validate identifiers
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(order_id) || !paypal_order_id) {
      return out({ error: "Invalid order identifiers." }, 400);
    }

    // Load order from database
    const { data: order, error: orderError } = await sb
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .maybeSingle();

    if (orderError) {
      throw new Error("Could not retrieve order.");
    }

    if (!order) {
      return out({ error: "Order not found." }, 404);
    }

    // Confirm PayPal order belongs to this database order
    if (order.paypal_order_id !== paypal_order_id) {
      return out({ error: "PayPal order does not match." }, 400);
    }

    // Already processed
    if (["paid", "processing", "completed"].includes(order.status)) {
      return out({
        ok: true,
        status: order.status,
        already_captured: true
      });
    }

    // Recover if capture was saved but status processing was interrupted
    if (
      order.payment_status === "completed" &&
      order.paypal_capture_id
    ) {
      const recovered = await setStatus(order_id, "paid");

      if (recovered) {
        return out({
          ok: true,
          status: recovered.status,
          capture_id: order.paypal_capture_id,
          recovered: true
        });
      }

      return out({
        ok: false,
        status: order.status,
        error: "Payment captured, but order processing needs attention."
      }, 409);
    }

    const expectedCents = toCents(order.amount);

    if (expectedCents < 50) {
      return out({ error: "Invalid order amount." }, 400);
    }

    // Authenticate with PayPal
    const token = await paypalAccessToken();
    const base = paypalBase();

    // Retrieve PayPal order
    const getResponse = await fetch(
      `${base}/v2/checkout/orders/${encodeURIComponent(paypal_order_id)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    const current = await getResponse.json();

    if (!getResponse.ok) {
      return out({
        error: current.message ?? "Could not verify PayPal order."
      }, 409);
    }

    if (current.status !== "APPROVED") {
      return out({
        error: "PayPal payment has not been approved.",
        paypal_status: current.status
      }, 409);
    }

    // Verify PayPal order details
    const purchaseUnit = current.purchase_units?.[0];
    const orderAmount = purchaseUnit?.amount;

    if (
      purchaseUnit?.custom_id !== order_id ||
      purchaseUnit?.reference_id !== order_id ||
      orderAmount?.currency_code !== "EUR" ||
      toCents(orderAmount?.value) !== expectedCents
    ) {
      return out({
        error: "PayPal order details do not match."
      }, 400);
    }

    // Capture payment
    const captureResponse = await fetch(
      `${base}/v2/checkout/orders/${encodeURIComponent(paypal_order_id)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `zksocial-capture-${order_id}`
        }
      }
    );

    const captureResult = await captureResponse.json();

    if (!captureResponse.ok) {
      return out({
        error: captureResult.message ?? "PayPal capture failed."
      }, 409);
    }

    if (captureResult.status !== "COMPLETED") {
      return out({
        error: "PayPal has not completed the payment.",
        paypal_status: captureResult.status
      }, 409);
    }

    // Verify captured payment
    const capturedUnit = captureResult.purchase_units?.[0];

    const payment = capturedUnit?.payments?.captures?.find(
      (item: { status?: string }) => item.status === "COMPLETED"
    );

    if (
      capturedUnit?.custom_id !== order_id ||
      capturedUnit?.reference_id !== order_id ||
      !payment?.id ||
      payment.status !== "COMPLETED" ||
      payment.amount?.currency_code !== "EUR" ||
      toCents(payment.amount?.value) !== expectedCents
    ) {
      return out({
        error: "Captured payment could not be verified."
      }, 400);
    }

    // Save verified payment information
    const { error: updateError } = await sb
      .from("orders")
      .update({
        paypal_capture_id: payment.id,
        payment_status: "completed",
        payment_completed_at: new Date().toISOString()
      })
      .eq("id", order_id)
      .eq("payment_status", "pending");

    if (updateError) {
      throw new Error(
        "Payment captured, but payment details could not be saved."
      );
    }

    // Only now mark order as paid and trigger fulfilment
    const updated = await setStatus(order_id, "paid");

    if (!updated) {
      const { data: latest, error: latestError } = await sb
        .from("orders")
        .select("status, payment_status, paypal_capture_id")
        .eq("id", order_id)
        .maybeSingle();

      if (latestError) {
        throw new Error("Payment captured, but order status could not be checked.");
      }

      return out({
        ok: ["paid", "processing", "completed"].includes(latest?.status),
        status: latest?.status,
        capture_id: latest?.paypal_capture_id
      });
    }

    return out({
      ok: true,
      status: updated.status,
      capture_id: payment.id
    });

  } catch (error) {
    console.error("PayPal capture error:", error);

    return out({
      error: error instanceof Error
        ? error.message
        : "Unexpected payment error."
    }, 500);
  }
});

