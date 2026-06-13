-- Add manifest_id to owned_dlcs so launcher can download DLC by manifest id

alter table public.owned_dlcs
  add column if not exists manifest_id bigint;

create index if not exists owned_dlcs_user_base_manifest_idx
  on public.owned_dlcs (user_id, base_appid, manifest_id);
