-- Lowers the shortest allowed site password from 12 to 9 characters. The limits
-- on wrong attempts keep guessing through the app slow. A password this short
-- must still be hard to guess.
--
-- Only the check changes. "create or replace" keeps the rights: clients still
-- can't run this function.

create or replace function private.set_app_password(p_password text) returns text
language plpgsql set search_path = '' as $$
declare
  v_password text := btrim(coalesce(p_password, ''));
begin
  -- bcrypt ignores everything after 72 bytes.
  if char_length(v_password) < 9 or octet_length(v_password) > 72 then
    raise exception 'The password needs 9 to 72 characters.';
  end if;
  insert into private.app_password (hash)
  values (extensions.crypt(v_password, extensions.gen_salt('bf', 10)))
  on conflict (only_row) do update set hash = excluded.hash, set_at = now();
  delete from private.app_access where true;
  delete from private.password_failures where true;
  return 'The password is set. Protection is ON.';
end $$;
