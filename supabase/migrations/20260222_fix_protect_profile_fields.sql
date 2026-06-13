-- Fix: allow trusted server-side RPCs to update profiles.balance even when a
-- BEFORE UPDATE trigger protects the field for normal clients.
--
-- This keeps the original protection behavior, but introduces a per-transaction
-- bypass flag that SECURITY DEFINER functions can set:
--   perform set_config('app.bypass_profile_protection', '1', true);
--
-- Run in Supabase SQL Editor.

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
as $function$
declare
  bypass boolean := (current_setting('app.bypass_profile_protection', true) = '1');
  req_role text := coalesce(auth.role(), '');
begin
  if bypass then
    return new;
  end if;

  -- If the requester is not the service_role (system), prevent unauthorized changes
  if req_role <> 'service_role' then
    -- On INSERT, force default values
    if (tg_op = 'INSERT') then
      new.role := 'user';
      new.balance := 0;
    -- On UPDATE, prevent changing role or balance
    elsif (tg_op = 'UPDATE') then
      if (new.role is distinct from old.role) then
        new.role := old.role;
      end if;

      if (new.balance is distinct from old.balance) then
        new.balance := old.balance;
      end if;
    end if;
  end if;

  return new;
end;
$function$;
