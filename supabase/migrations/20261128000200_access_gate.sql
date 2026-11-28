-- A site password, per-room invite links, and an access log only the owner reads.
--
-- Creating a room needs the password. Joining one needs the password or that
-- room's invite (the QR code and copied link). A password is entered once per
-- browser, which means per anonymous account.
--
-- The gate is OFF while no password is set, so this can be applied before the
-- new app version is deployed. Turn it on, change it, or turn it off in the SQL
-- Editor:
--
--   select private.set_app_password('four random words or more');
--   select private.remove_app_password();
--
-- Compatible with the app version that is already deployed, as long as no
-- password is set.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- At most one row. No row: no gate.
create table private.app_password (
  only_row boolean primary key default true check (only_row),
  hash     text not null,
  set_at   timestamptz not null default now()
);

-- Accounts that have entered the current password.
create table private.app_access (
  user_id    uuid primary key,
  granted_at timestamptz not null default now()
);

create table private.room_invites (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  -- 122 random bits.
  token   text not null default replace(gen_random_uuid()::text, '-', '')
);

-- For the attempt limits. Separate from the log, which has a size cap: the
-- limits must keep working when the log is full.
create table private.password_failures (
  at      timestamptz not null default now(),
  user_id uuid not null,
  ip      text
);
create index on private.password_failures (at);

-- Kept until the owner deletes entries. No reference to rooms or accounts, so
-- that entries outlive both.
create table private.access_log (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  user_id       uuid not null,
  action        text not null check (action in (
                  'room_created', 'joined', 'returned', 'lookup', 'lookup_denied',
                  'password_ok', 'password_wrong', 'password_blocked')),
  name          text,
  room_code     text,
  -- Both come from request headers. They help to recognize visitors, but can be
  -- misleading, so nothing is ever allowed or refused because of them alone.
  ip            text,
  forwarded_for text,
  user_agent    text
);
create index on private.access_log (at);
create index on private.access_log (user_id, at);
create index on private.access_log (ip, at);

alter table private.app_password      enable row level security;
alter table private.app_access        enable row level security;
alter table private.room_invites      enable row level security;
alter table private.password_failures enable row level security;
alter table private.access_log        enable row level security;

-- One row per account.
create view private.access_overview as
select
  l.user_id,
  (array_agg(l.name order by l.at desc, l.id desc)
     filter (where l.name is not null))[1]            as last_name,
  max(l.at)                                           as last_seen,
  min(l.at)                                           as first_seen,
  (array_agg(l.ip order by l.at desc, l.id desc))[1]  as last_ip,
  (array_agg(l.user_agent order by l.at desc, l.id desc))[1] as last_user_agent,
  count(*)                                            as entries,
  count(*) filter (where l.action = 'password_wrong') as wrong_passwords,
  exists (select 1 from private.app_access a
          where a.user_id = l.user_id)                as knows_password
from private.access_log l
group by l.user_id
order by max(l.at) desc;

-- The size cap. New entries stop when it is reached; nothing is deleted.
create function private.access_log_limit() returns int
language sql immutable set search_path = '' as $$ select 100000 $$;

create view private.access_status as
select
  exists (select 1 from private.app_password)        as password_set,
  (select count(*) from private.access_log)          as log_entries,
  private.access_log_limit()                         as log_limit;

-- ---------------------------------------------------------------------------
-- For the owner (SQL Editor only)
-- ---------------------------------------------------------------------------

-- Sets or changes the password. Every browser has to enter it again; people who
-- are in a room stay in it.
create function private.set_app_password(p_password text) returns text
language plpgsql set search_path = '' as $$
declare
  v_password text := btrim(coalesce(p_password, ''));
begin
  -- bcrypt ignores everything after 72 bytes.
  if char_length(v_password) < 12 or octet_length(v_password) > 72 then
    raise exception 'The password needs 12 to 72 characters.';
  end if;
  insert into private.app_password (hash)
  values (extensions.crypt(v_password, extensions.gen_salt('bf', 10)))
  on conflict (only_row) do update set hash = excluded.hash, set_at = now();
  delete from private.app_access where true;
  delete from private.password_failures where true;
  return 'The password is set. Protection is ON.';
end $$;

create function private.remove_app_password() returns text
language plpgsql set search_path = '' as $$
begin
  delete from private.app_password where true;
  delete from private.app_access where true;
  delete from private.password_failures where true;
  return 'The password is removed. Protection is OFF.';
end $$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function private.has_access() returns boolean
language sql stable set search_path = '' as $$
  select not exists (select 1 from private.app_password)
      or exists (select 1 from private.app_access where user_id = auth.uid())
$$;

-- Whether the caller may look up and join this room.
create function private.can_enter(p_room_id uuid, p_invite text) returns boolean
language sql stable set search_path = '' as $$
  select private.has_access()
      or private.is_member(p_room_id)
      or exists (select 1 from private.room_invites
                 where room_id = p_room_id and token = p_invite)
$$;

-- The request headers, as PostgREST hands them over. Empty if there are none.
create function private.request_headers() returns json
language plpgsql stable set search_path = '' as $$
begin
  return coalesce(
    nullif(current_setting('request.headers', true), '')::json, '{}'::json);
exception when others then
  return '{}'::json;
end $$;

-- The best guess at the caller's address.
create function private.client_ip() returns text
language sql stable set search_path = '' as $$
  select left(coalesce(
    nullif(btrim(h ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), '')), 100)
  from private.request_headers() h
$$;

create function private.log_access(
  p_action text, p_name text default null, p_room_code text default null)
returns void
language plpgsql set search_path = '' as $$
declare
  v_user    uuid := auth.uid();
  v_headers json := private.request_headers();
  v_ip      text := private.client_ip();
  v_since   timestamptz := now() - interval '1 hour';
begin
  -- The app repeats these while a page is open. Once an hour is enough.
  if p_action in ('lookup', 'lookup_denied', 'returned', 'password_blocked')
     and exists (select 1 from private.access_log
                 where user_id = v_user and at > v_since
                   and room_code is not distinct from p_room_code
                   and ip is not distinct from v_ip
                   -- Having just joined counts as being there.
                   and (action = p_action
                        or (p_action = 'returned'
                            and action in ('joined', 'room_created')))) then
    return;
  end if;

  -- Limits against flooding: per account, per address, in total per hour, and
  -- the size of the whole log.
  if (select count(*) from private.access_log
      where user_id = v_user and at > v_since) >= 60
     or (select count(*) from private.access_log
         where ip = v_ip and at > v_since) >= 300
     or (select count(*) from private.access_log where at > v_since) >= 2000
     or (select count(*) from private.access_log)
        >= private.access_log_limit() then
    return;
  end if;

  insert into private.access_log
    (user_id, action, name, room_code, ip, forwarded_for, user_agent)
  values
    (v_user, p_action, p_name, p_room_code, v_ip,
     left(v_headers ->> 'x-forwarded-for', 200),
     left(v_headers ->> 'user-agent', 300));
end $$;

-- ---------------------------------------------------------------------------
-- Functions callable by clients
-- ---------------------------------------------------------------------------

-- Checks the password. Wrong attempts are answered, not raised: an error would
-- undo the record of the attempt.
create function public.unlock(p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_ip   text := private.client_ip();
  v_hash text;
begin
  -- One attempt at a time, so that parallel requests can't slip past the limits.
  perform pg_advisory_xact_lock(hashtext('party-games:unlock'));

  select hash into v_hash from private.app_password;
  if not found then
    return 'ok';
  end if;

  delete from private.password_failures where at < now() - interval '1 day';
  -- 10 per account or address in 15 minutes, 100 in total per hour.
  if (select count(*) from private.password_failures
      where at > now() - interval '15 minutes'
        and (user_id = v_user or ip = v_ip)) >= 10
     or (select count(*) from private.password_failures
         where at > now() - interval '1 hour') >= 100 then
    perform private.log_access('password_blocked');
    return 'blocked';
  end if;

  -- Phone keyboards like to add a space.
  if octet_length(coalesce(p_password, '')) <= 200
     and extensions.crypt(btrim(p_password), v_hash) = v_hash then
    insert into private.app_access (user_id) values (v_user)
    on conflict (user_id) do nothing;
    perform private.log_access('password_ok');
    return 'ok';
  end if;

  insert into private.password_failures (user_id, ip) values (v_user, v_ip);
  perform private.log_access('password_wrong');
  return 'wrong';
end $$;

-- The secret in a room's QR code and join link. Only for people in the room.
create function public.room_invite(p_room_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  perform private.lock_room(p_room_id);
  insert into private.room_invites (room_id) values (p_room_id)
  on conflict (room_id) do nothing;
  select token into v_token from private.room_invites where room_id = p_room_id;
  return v_token;
end $$;

-- For the log: a member opened the room again.
create function public.note_return(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_code text;
begin
  select p.name, r.code into v_name, v_code
  from public.players p join public.rooms r on r.id = p.room_id
  where p.room_id = p_room_id and p.user_id = private.require_user();
  if found then
    perform private.log_access('returned', v_name, v_code);
  end if;
end $$;

-- As before, plus the password check and the log.
create or replace function public.create_room(p_game_type text, p_name text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user     uuid := private.require_user();
  v_name     text := private.clean_name(p_name);
  -- No 0/O, 1/I/L.
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_room_id  uuid;
begin
  if not private.has_access() then
    raise exception 'access_required';
  end if;
  if not exists (select 1 from public.game_types where id = p_game_type) then
    raise exception 'unknown_game';
  end if;
  if (select count(*) from public.rooms
      where host_id = v_user
        and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_rooms';
  end if;

  loop
    select string_agg(
             substr(v_alphabet,
                    1 + floor(random() * length(v_alphabet))::int, 1), '')
    into v_code
    from generate_series(1, 5);

    insert into public.rooms (code, game_type, host_id)
    values (v_code, p_game_type, v_user)
    on conflict (code) do nothing
    returning id into v_room_id;

    exit when v_room_id is not null;
  end loop;

  perform private.add_player(v_room_id, v_user, v_name);
  perform private.log_access('room_created', v_name, v_code);
  return v_code;
end $$;

-- Gets the invite and a new column, so both are re-created. The old app calls
-- them without an invite, which still works.
drop function public.get_room_info(text);
drop function public.join_room(text, text);

-- Without access, the answer is the same whether the room exists or not.
create function public.get_room_info(p_code text, p_invite text default null)
returns table (game_type text, status text, joinable boolean,
               access_required boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_room public.rooms;
  v_code text := left(upper(btrim(p_code)), 5);
begin
  if auth.uid() is null then
    return;
  end if;
  select * into v_room from public.rooms r where r.code = upper(btrim(p_code));

  if not private.can_enter(v_room.id, p_invite) then
    perform private.log_access('lookup_denied', null, v_code);
    return query select null::text, null::text, null::boolean, true;
    return;
  end if;

  perform private.log_access('lookup', null, v_code);
  if v_room.id is not null then
    return query select v_room.game_type, v_room.status,
      v_room.status = 'lobby' or v_room.open_to_join, false;
  end if;
end $$;

create function public.join_room(
  p_code text, p_name text, p_invite text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_name text := private.clean_name(p_name);
  v_room public.rooms;
begin
  select * into v_room from public.rooms
  where code = upper(btrim(p_code)) for update;

  -- Checked first, so that codes can't be probed without access.
  if not private.can_enter(v_room.id, p_invite) then
    raise exception 'access_required';
  end if;
  if v_room.id is null then
    raise exception 'room_not_found';
  end if;

  -- Reconnect: members keep their seat and name.
  if private.is_member(v_room.id) then
    perform public.note_return(v_room.id);
    return v_room.id;
  end if;

  if exists (select 1 from private.room_bans
             where room_id = v_room.id and user_id = v_user) then
    raise exception 'kicked';
  end if;
  if v_room.status <> 'lobby' and not v_room.open_to_join then
    raise exception 'game_running';
  end if;
  if (select count(*) from public.players where room_id = v_room.id) >=
     (select max_players from public.game_types where id = v_room.game_type) then
    raise exception 'room_full';
  end if;
  if exists (select 1 from public.players
             where room_id = v_room.id and lower(name) = lower(v_name)) then
    raise exception 'name_taken';
  end if;

  perform private.add_player(v_room.id, v_user, v_name);
  perform private.touch(v_room.id);
  perform private.log_access('joined', v_name, v_room.code);
  return v_room.id;
end $$;

-- As before, plus: removing someone replaces the invite they may have used.
create or replace function public.kick_player(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  if v_room.host_id <> auth.uid() then
    raise exception 'not_host';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'invalid_action';
  end if;

  delete from public.players where room_id = p_room_id and user_id = p_user_id;
  if found then
    insert into private.room_bans (room_id, user_id)
    values (p_room_id, p_user_id) on conflict do nothing;
    delete from private.room_invites where room_id = p_room_id;
    perform private.touch(p_room_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

revoke execute on function
  public.unlock(text),
  public.room_invite(uuid),
  public.note_return(uuid),
  public.get_room_info(text, text),
  public.join_room(text, text, text)
from public, anon;

grant execute on function
  public.unlock(text),
  public.room_invite(uuid),
  public.note_return(uuid),
  public.get_room_info(text, text),
  public.join_room(text, text, text)
to authenticated;

revoke all on private.access_overview, private.access_status
from public, anon, authenticated;

-- See 20261128000100_lock_down_private.sql.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid) to authenticated;
