-- Shared hub / lobby system, reusable by every game.
--
-- Rules of the house:
--   * Clients only ever SELECT from tables (filtered by Row Level Security).
--     All writes go through the SECURITY DEFINER functions below.
--   * Realtime only publishes public.rooms. Every change bumps rooms.version,
--     and clients then re-fetch whatever RLS lets them see.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
-- New functions in "private" must be granted explicitly.
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.game_types (
  id          text primary key,
  min_players int  not null,
  max_players int  not null
);

create table public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  game_type        text not null references public.game_types (id),
  status           text not null default 'lobby'
                     check (status in ('lobby', 'playing', 'finished')),
  host_id          uuid not null,
  version          bigint not null default 1,
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table public.players (
  room_id    uuid not null references public.rooms (id) on delete cascade,
  user_id    uuid not null,
  name       text not null check (char_length(name) between 1 and 20),
  seat_order int  not null,
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat_order)
);

-- Kept apart from public.players so heartbeats don't trigger live updates.
create table private.heartbeats (
  room_id   uuid not null,
  user_id   uuid not null,
  last_seen timestamptz not null default now(),
  primary key (room_id, user_id),
  foreign key (room_id, user_id)
    references public.players (room_id, user_id) on delete cascade
);

create table private.room_bans (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null,
  primary key (room_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  return auth.uid();
end $$;

create function private.is_member(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.players
    where room_id = p_room_id and user_id = auth.uid()
  )
$$;
grant execute on function private.is_member(uuid) to authenticated;

-- Locks the room row, so all actions within one room run one after another.
create function private.lock_room(p_room_id uuid) returns public.rooms
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms;
begin
  perform private.require_user();
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not private.is_member(p_room_id) then
    raise exception 'not_in_room';
  end if;
  return v_room;
end $$;

create function private.touch(p_room_id uuid) returns void
language sql set search_path = '' as $$
  update public.rooms
  set version = version + 1, last_activity_at = now()
  where id = p_room_id
$$;

-- A player counts as gone when no heartbeat arrived for 45 seconds.
create function private.is_stale(p_room_id uuid, p_user_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select not exists (
    select 1 from private.heartbeats
    where room_id = p_room_id and user_id = p_user_id
      and last_seen > now() - interval '45 seconds'
  )
$$;

create function private.clean_name(p_name text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(v_name) < 1 or char_length(v_name) > 20 then
    raise exception 'invalid_name';
  end if;
  return v_name;
end $$;

create function private.add_player(p_room_id uuid, p_user_id uuid, p_name text)
returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.players (room_id, user_id, name, seat_order)
  select p_room_id, p_user_id, p_name, coalesce(max(seat_order), 0) + 1
  from public.players where room_id = p_room_id;

  insert into private.heartbeats (room_id, user_id)
  values (p_room_id, p_user_id);
end $$;

-- Hands the host role to the next player (by seat) other than the current host.
create function private.transfer_host(p_room_id uuid) returns void
language sql set search_path = '' as $$
  update public.rooms r
  set host_id = p.user_id
  from (
    select p2.user_id
    from public.players p2
    join public.rooms r2 on r2.id = p2.room_id
    where p2.room_id = p_room_id and p2.user_id <> r2.host_id
    order by private.is_stale(p_room_id, p2.user_id), p2.seat_order
    limit 1
  ) p
  where r.id = p_room_id
$$;

create function private.cleanup_old_rooms() returns void
language sql security definer set search_path = '' as $$
  delete from public.rooms r
  where r.last_activity_at < now() - interval '24 hours'
    and not exists (
      select 1 from private.heartbeats h
      where h.room_id = r.id and h.last_seen > now() - interval '24 hours'
    )
$$;

-- ---------------------------------------------------------------------------
-- Room functions (callable by clients)
-- ---------------------------------------------------------------------------

create function public.create_room(p_game_type text, p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user     uuid := private.require_user();
  v_name     text := private.clean_name(p_name);
  -- No 0/O, 1/I/L.
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_room_id  uuid;
begin
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
  return v_code;
end $$;

-- The only thing a non-member can learn about a room.
create function public.get_room_info(p_code text)
returns table (game_type text, status text)
language sql stable security definer set search_path = '' as $$
  select r.game_type, r.status
  from public.rooms r
  where r.code = upper(btrim(p_code)) and auth.uid() is not null
$$;

create function public.join_room(p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_name text := private.clean_name(p_name);
  v_room public.rooms;
begin
  select * into v_room from public.rooms
  where code = upper(btrim(p_code)) for update;
  if not found then
    raise exception 'room_not_found';
  end if;

  -- Reconnect: members keep their seat and name.
  if private.is_member(v_room.id) then
    return v_room.id;
  end if;

  if exists (select 1 from private.room_bans
             where room_id = v_room.id and user_id = v_user) then
    raise exception 'kicked';
  end if;
  if v_room.status <> 'lobby' then
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
  return v_room.id;
end $$;

-- Room and player list in one consistent read. Runs with the caller's rights,
-- so RLS applies: non-members get null.
create function public.room_snapshot(p_code text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'room', jsonb_build_object(
      'id', r.id, 'code', r.code, 'game_type', r.game_type,
      'status', r.status, 'host_id', r.host_id, 'version', r.version),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'name', p.name,
               'seat_order', p.seat_order) order by p.seat_order), '[]'::jsonb)
      from public.players p where p.room_id = r.id)
  )
  from public.rooms r
  where r.code = upper(btrim(p_code))
$$;

create function public.heartbeat(p_room_id uuid) returns void
language sql security definer set search_path = '' as $$
  update private.heartbeats set last_seen = now()
  where room_id = p_room_id and user_id = auth.uid()
$$;

create function public.leave_room(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  if v_room.host_id = auth.uid() then
    perform private.transfer_host(p_room_id);
  end if;

  delete from public.players
  where room_id = p_room_id and user_id = auth.uid();

  if not exists (select 1 from public.players where room_id = p_room_id) then
    delete from public.rooms where id = p_room_id;
  else
    perform private.touch(p_room_id);
  end if;
end $$;

create function public.kick_player(p_room_id uuid, p_user_id uuid) returns void
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
    perform private.touch(p_room_id);
  end if;
end $$;

create function public.claim_host(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  if v_room.host_id = auth.uid() then
    return;
  end if;
  if not private.is_stale(p_room_id, v_room.host_id) then
    raise exception 'host_still_here';
  end if;
  update public.rooms set host_id = auth.uid() where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Ends or aborts the current game and returns everyone to the lobby.
create function public.return_to_lobby(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  if v_room.host_id <> auth.uid() then
    raise exception 'not_host';
  end if;
  update public.rooms set status = 'lobby' where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table public.game_types enable row level security;
alter table public.rooms      enable row level security;
alter table public.players    enable row level security;
alter table private.heartbeats enable row level security;
alter table private.room_bans  enable row level security;

revoke all on public.game_types, public.rooms, public.players
  from anon, authenticated;
grant select on public.game_types, public.rooms, public.players
  to authenticated;

create policy "signed-in users can read game types" on public.game_types
  for select to authenticated using (true);
create policy "members can read their room" on public.rooms
  for select to authenticated using (private.is_member(id));
create policy "members can read players" on public.players
  for select to authenticated using (private.is_member(room_id));

revoke execute on function
  public.create_room(text, text),
  public.get_room_info(text),
  public.join_room(text, text),
  public.room_snapshot(text),
  public.heartbeat(uuid),
  public.leave_room(uuid),
  public.kick_player(uuid, uuid),
  public.claim_host(uuid),
  public.return_to_lobby(uuid)
from public, anon;

grant execute on function
  public.create_room(text, text),
  public.get_room_info(text),
  public.join_room(text, text),
  public.room_snapshot(text),
  public.heartbeat(uuid),
  public.leave_room(uuid),
  public.kick_player(uuid, uuid),
  public.claim_host(uuid),
  public.return_to_lobby(uuid)
to authenticated;

alter publication supabase_realtime add table public.rooms;

-- Hourly cleanup of rooms that have been idle for 24 hours.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'cleanup-old-rooms', '17 * * * *', 'select private.cleanup_old_rooms()');
exception when others then
  raise warning 'pg_cron not available, old rooms are not cleaned up: %', sqlerrm;
end $$;
