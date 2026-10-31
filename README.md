# ZKSocial – deploy guide

Static site (index.html + config.js) + Supabase (database, admin login, edge functions). Payment by PayPal link, notifications by Telegram, emails by Resend.

## How an order works
1. The customer picks a service and presses **Get payment link**. The order is saved as *awaiting payment*.
2. The customer sees (and gets by email) a PayPal link for the exact amount, an order code and a tracking link. You get a Telegram message with buttons.
3. You see the payment in PayPal and press **Paid** in Telegram or in Admin > Orders. The order goes to your supplier (if configured) and the customer gets a "payment received" email.
4. Press **Complete** when it is done. Customers follow every step on the tracking page (`/#track`).

## Setup
1. **Supabase**: create a project and run `supabase/schema.sql` in the SQL editor. Add your login in Authentication > Users, then run `insert into admins values ('you@example.com');`.
2. **config.js**: paste the project URL and anon key.
3. **Functions** (Supabase CLI):
   ```
   supabase functions deploy create-order
   supabase functions deploy order-action
   supabase functions deploy telegram-bot --no-verify-jwt
   supabase secrets set SITE_URL=https://yourdomain.com
   ```
4. **PayPal**: Admin > Payments > enter your PayPal.me username (create one at paypal.me if needed).
5. **Email** (Resend): create an API key and verify your sending domain, then
   `supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="ZKSocial <orders@yourdomain.com>"`
6. **Telegram**: message @BotFather, send /newbot and copy the token, then
   `supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_SECRET=any-long-random-string`
   Open once in a browser:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project-ref>.supabase.co/functions/v1/telegram-bot&secret_token=<TELEGRAM_SECRET>`
   Send /start to your bot, it replies with your chat ID, then `supabase secrets set TELEGRAM_CHAT_ID=<id>`.
   Check with Admin > Payments > Send test notification. Bot commands: /orders (last 10), /pending (awaiting payment).
7. **Supplier** (optional): `supabase secrets set PROVIDER_API_URL=... PROVIDER_API_KEY=...` and enter the supplier service ID per product in Admin > Products.
8. **Hosting**: upload index.html and config.js to Netlify, Vercel or Cloudflare Pages. Open `/#admin`, sign in and press **Save changes** once to create your products.

## Notes
- PayPal.me has no automatic callback, so you confirm each payment yourself. Customers are asked to put the order code in the PayPal note so you can match it. Automatic confirmation needs the PayPal REST API and can be added later.
- Before going live fill in the Imprint, Privacy, Terms and Refund texts (Germany also needs a Widerrufsbelehrung) and check that PayPal allows this type of service.
