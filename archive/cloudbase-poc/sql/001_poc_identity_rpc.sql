-- Isolated read-only identity diagnostic for the CloudBase Auth PoC.
-- This function does not read or modify ShangMethod business data.
-- It is SECURITY DEFINER solely because authenticated clients should not be
-- granted direct SELECT access to auth.users. The function exposes only the
-- current caller's ID and explicitly rejects non-authenticated requests.

create or replace function public.poc_current_identity()
returns table (
  auth_uid text,
  auth_user_id text,
  identity_matches boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_uid text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'authenticated session required';
  end if;

  current_uid := auth.uid();

  if current_uid is null or current_uid !~ '^[0-9]+$' then
    raise exception 'current JWT sub is not a numeric CloudBase user ID';
  end if;

  return query
  select
    current_uid,
    users.id::text,
    current_uid::bigint = users.id
  from auth.users as users
  where users.id = current_uid::bigint;
end;
$$;

revoke all on function public.poc_current_identity() from public;
revoke all on function public.poc_current_identity() from anon;
grant execute on function public.poc_current_identity() to authenticated;
