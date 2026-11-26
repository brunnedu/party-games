-- Shared lobby system: games may let new players join between two rounds.
-- A game sets rooms.open_to_join while that is safe.
-- Compatible with the app version that is already deployed.

alter table public.rooms
  add column open_to_join boolean not null default false;

-- The return type gets a new column, so the function has to be re-created.
drop function public.get_room_info(text);

create function public.get_room_info(p_code text)
returns table (game_type text, status text, joinable boolean)
language sql stable security definer set search_path = '' as $$
  select r.game_type, r.status, r.status = 'lobby' or r.open_to_join
  from public.rooms r
  where r.code = upper(btrim(p_code)) and auth.uid() is not null
$$;

revoke execute on function public.get_room_info(text) from public, anon;
grant execute on function public.get_room_info(text) to authenticated;

create or replace function public.join_room(p_code text, p_name text) returns uuid
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
  return v_room.id;
end $$;

create or replace function public.return_to_lobby(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  if v_room.host_id <> auth.uid() then
    raise exception 'not_host';
  end if;
  update public.rooms set status = 'lobby', open_to_join = false
  where id = p_room_id;
  perform private.touch(p_room_id);
end $$;
