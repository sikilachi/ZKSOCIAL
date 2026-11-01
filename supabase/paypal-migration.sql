-- Run once in Supabase SQL Editor before deploying the new functions.
alter table public.orders add column if not exists paypal_order_id text unique;
alter table public.orders add column if not exists paypal_capture_id text unique;
alter table public.orders add column if not exists payment_status text not null default 'unpaid';
create index if not exists orders_paypal_order_id_idx on public.orders(paypal_order_id);
