-- Run in the Supabase SQL editor.
create table settings (id int primary key, cfg jsonb not null default '{}');
create table products (
  id text primary key, pf text not null, n text not null, t text not null default 'l',
  r numeric not null, a int not null, b int not null, bd text,
  active boolean not null default true, provider_service text, sort int not null default 0
);
create table orders (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  product_id text, pf text, name text, target text, qty int, premium boolean default false,
  email text, amount numeric(10,2), status text not null default 'awaiting_payment',
  provider_order text, note text
);
create table admins (email text primary key);

create function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = (auth.jwt() ->> 'email'))
$$;

alter table settings enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table admins enable row level security;

create policy "settings read" on settings for select using (true);
create policy "settings admin" on settings for all using (is_admin()) with check (is_admin());
create policy "products read" on products for select using (active or is_admin());
create policy "products admin" on products for all using (is_admin()) with check (is_admin());
create policy "orders admin" on orders for all using (is_admin()) with check (is_admin());

-- Create your login in Authentication > Users first, then:
-- insert into admins values ('you@example.com');

-- Lets a customer look up one order with its ID and email (used by the tracking page).
create function track_order(p_id uuid, p_mail text) returns json language sql stable security definer set search_path = public as $$
  select json_build_object('pf', pf, 'name', name, 'qty', qty, 'target', target, 'amount', amount, 'status', status, 'created_at', created_at)
  from orders where id = p_id and lower(email) = lower(p_mail)
$$;
