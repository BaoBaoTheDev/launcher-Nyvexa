-- Audit table for web purchases (balance before/after) + safer balance deduction with row lock.
-- Run in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.web_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  game_id uuid not null,
  giftcode text not null,
  price bigint not null,
  balance_before numeric,
  balance_after numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_web_purchases_user_created_at
  on public.web_purchases(user_id, created_at desc);

create unique index if not exists uq_web_purchases_giftcode
  on public.web_purchases(giftcode);

-- Replace function to (1) lock profile row, (2) record before/after balances.
create or replace function public.web_purchase_game(p_user_id uuid, p_game_id uuid)
returns table(
  code text,
  game_name text,
  price bigint,
  new_balance bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price bigint;
  v_name text;
  v_old_balance numeric;
  v_expected_balance numeric;
  v_new_balance numeric;
  v_code text;
  attempt int;
begin
  select g.price, g.name
    into v_price, v_name
  from public.games g
  where g.id = p_game_id;

  if v_price is null then
    raise exception 'GAME_NOT_FOUND';
  end if;

  -- Lock the profile row to capture an authoritative "before" balance.
  select p.balance
    into v_old_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if v_old_balance is null then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  if v_old_balance < v_price then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  v_expected_balance := v_old_balance - v_price;

  -- Bypass profile protection trigger in this transaction (see migration 20260222_fix_protect_profile_fields.sql)
  perform set_config('app.bypass_profile_protection', '1', true);

  update public.profiles
    set balance = v_expected_balance
  where id = p_user_id
  returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  -- If a trigger/policy overwrote the value, do NOT proceed.
  if v_new_balance is distinct from v_expected_balance then
    raise exception 'BALANCE_NOT_UPDATED';
  end if;

  for attempt in 1..12 loop
    v_code := public.generate_giftcode_25();
    begin
      insert into public.giftcodes (code, game_id, amount, max_uses, used_count)
      values (v_code, p_game_id, 0, 1, 0);

      insert into public.web_purchases (user_id, game_id, giftcode, price, balance_before, balance_after)
      values (p_user_id, p_game_id, v_code, v_price, v_old_balance, v_new_balance);

      code := v_code;
      game_name := v_name;
      price := v_price;
      new_balance := v_new_balance::bigint;
      return next;
      return;
    exception
      when unique_violation then
        -- retry
    end;
  end loop;

  raise exception 'GIFT_CODE_GENERATION_FAILED';
end;
$$;

revoke all on function public.web_purchase_game(uuid, uuid) from public;
