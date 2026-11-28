-- Wavelength can also be played competitively. The host picks this in the lobby,
-- and it stays fixed for the whole game:
--   * everyone guesses on their own and keeps the points of their guess,
--   * the clue-giver gets the average of those points, to one decimal,
--   * at least 3 players, because with 2 both would always score the same.
--
-- Apply before deploying the new app version. The version already deployed keeps
-- working: games are cooperative unless the new setting says otherwise.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.wavelength_settings (
  room_id     uuid primary key references public.rooms (id) on delete cascade,
  competitive boolean not null default false
);

-- Copied from the settings when the game starts.
alter table public.wavelength_games
  add column competitive boolean not null default false;

-- Only filled in competitive games.
create table public.wavelength_scores (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  player_id uuid not null,
  score     numeric(6, 1) not null default 0,
  primary key (room_id, player_id)
);

-- ---------------------------------------------------------------------------
-- Lobby settings
-- ---------------------------------------------------------------------------

create function public.wavelength_lobby(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_room_id) then
    return null;
  end if;
  return jsonb_build_object(
    'competitive', coalesce(
      (select competitive from public.wavelength_settings
       where room_id = p_room_id), false));
end $$;

create function public.wavelength_set_settings(
  p_room_id uuid, p_competitive boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'wavelength' then
    raise exception 'wrong_phase';
  end if;
  if p_competitive is null then
    raise exception 'invalid_action';
  end if;
  insert into public.wavelength_settings (room_id, competitive)
  values (p_room_id, p_competitive)
  on conflict (room_id) do update set competitive = excluded.competitive;
  perform private.touch(p_room_id);
end $$;

-- ---------------------------------------------------------------------------
-- The game, as before plus the competitive variant
-- ---------------------------------------------------------------------------

create or replace function public.wavelength_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room        public.rooms := private.lock_room(p_room_id);
  v_count       int;
  v_first       public.players;
  v_competitive boolean;
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'wavelength' then
    raise exception 'wrong_phase';
  end if;
  v_competitive := coalesce(
    (select competitive from public.wavelength_settings
     where room_id = p_room_id), false);
  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < (case when v_competitive then 3 else 2 end) then
    raise exception 'not_enough_players';
  end if;

  delete from public.wavelength_games   where room_id = p_room_id;
  delete from public.wavelength_targets where room_id = p_room_id;
  delete from public.wavelength_guesses where room_id = p_room_id;
  delete from public.wavelength_history where room_id = p_room_id;
  delete from public.wavelength_scores  where room_id = p_room_id;

  select * into v_first from public.players
  where room_id = p_room_id order by random() limit 1;

  -- A placeholder row; the first round goes to v_first. Everyone gives the same
  -- number of clues: 3 each for 2-3 players, 2 for 4-6, 1 for 7-10.
  insert into public.wavelength_games
    (room_id, phase, round_no, rounds_total, giver_id, giver_seat,
     left_label, right_label, competitive)
  values
    (p_room_id, 'clue', 0,
     v_count * case when v_count <= 3 then 3 when v_count <= 6 then 2 else 1 end,
     v_first.user_id, v_first.seat_order - 1, '', '', v_competitive);
  perform private.wavelength_new_round(p_room_id);

  update public.rooms set status = 'playing' where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

create or replace function public.wavelength_give_clue(
  p_room_id uuid, p_round_no int, p_mode text, p_clue text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.wavelength_games;
  v_clue text := nullif(btrim(regexp_replace(coalesce(p_clue, ''), '\s+', ' ', 'g')), '');
begin
  v_game := private.wavelength_action(p_room_id, p_round_no, array['clue'], 'giver');
  if p_mode is null or p_mode not in ('shared', 'individual')
     or (v_game.competitive and p_mode <> 'individual') then
    raise exception 'invalid_action';
  end if;
  if char_length(v_clue) > 40 then
    raise exception 'clue_too_long';
  end if;
  update public.wavelength_games
  set phase = 'guessing', mode = p_mode, clue = v_clue
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

create or replace function private.wavelength_reveal(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game   public.wavelength_games;
  v_target int;
  v_points numeric(4, 2);
begin
  select * into v_game from public.wavelength_games where room_id = p_room_id;
  select target into v_target from public.wavelength_targets
  where room_id = p_room_id and round_no = v_game.round_no;

  if v_game.mode = 'shared' then
    v_points := private.wavelength_score(v_game.dial, v_target);
  else
    update public.wavelength_guesses
    set points = private.wavelength_score(position, v_target)
    where room_id = p_room_id and round_no = v_game.round_no;
    -- The average of everyone's points: what a cooperative round is worth, and
    -- in a competitive one what the clue-giver gets.
    select coalesce(round(avg(points),
             case when v_game.competitive then 1 else 2 end), 0)
    into v_points
    from public.wavelength_guesses
    where room_id = p_room_id and round_no = v_game.round_no;
  end if;

  if v_game.competitive then
    insert into public.wavelength_scores as s (room_id, player_id, score)
    select p_room_id, player_id, points
    from public.wavelength_guesses
    where room_id = p_room_id and round_no = v_game.round_no
    union all
    select p_room_id, v_game.giver_id, v_points
    on conflict (room_id, player_id)
    do update set score = s.score + excluded.score;
  end if;

  update public.wavelength_games set
    phase = 'reveal',
    target = v_target,
    round_points = v_points,
    points = points + v_points,
    rounds_played = rounds_played + 1
  where room_id = p_room_id;

  insert into public.wavelength_history
    (room_id, round_no, left_label, right_label, clue, target, points)
  values
    (p_room_id, v_game.round_no, v_game.left_label, v_game.right_label,
     v_game.clue, v_target, v_points);

  update public.rooms set open_to_join = true where id = p_room_id;
end $$;

create or replace function public.wavelength_next_round(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.wavelength_games := private.wavelength_action(
    p_room_id, p_round_no, array['reveal'], 'any');
begin
  if v_game.giver_id <> auth.uid() then
    perform private.require_host(p_room_id);
  end if;

  if v_game.rounds_played >= v_game.rounds_total then
    update public.wavelength_games set phase = 'game_over'
    where room_id = p_room_id;
    update public.rooms set status = 'finished', open_to_join = false
    where id = p_room_id;
  else
    if (select count(*) from public.players where room_id = p_room_id)
       < (case when v_game.competitive then 3 else 2 end) then
      raise exception 'not_enough_players';
    end if;
    perform private.wavelength_new_round(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

create or replace function private.wavelength_player_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.wavelength_games;
begin
  if not exists (select 1 from public.rooms
                 where id = old.room_id and status = 'playing') then
    return null;
  end if;
  select * into v_game from public.wavelength_games where room_id = old.room_id;
  if not found then
    return null;
  end if;

  if (select count(*) from public.players where room_id = old.room_id)
     < (case when v_game.competitive then 3 else 2 end) then
    update public.wavelength_games set phase = 'game_over'
    where room_id = old.room_id;
    update public.rooms set status = 'finished', open_to_join = false
    where id = old.room_id;
    return null;
  end if;

  if v_game.phase not in ('clue', 'guessing') then
    return null;
  end if;

  if v_game.giver_id = old.user_id then
    perform private.wavelength_new_round(old.room_id);
    return null;
  end if;

  delete from public.wavelength_guesses
  where room_id = old.room_id and round_no = v_game.round_no
    and player_id = old.user_id;
  update public.wavelength_games
  set done_ids = array_remove(done_ids, old.user_id)
  where room_id = old.room_id;

  if v_game.phase = 'guessing' and private.wavelength_all_done(old.room_id) then
    perform private.wavelength_reveal(old.room_id);
  end if;
  return null;
end $$;

create or replace function public.wavelength_snapshot(p_room_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'game', to_jsonb(g) - 'used_pairs',
    'secret_target', (
      select t.target from public.wavelength_targets t
      where t.room_id = g.room_id and t.round_no = g.round_no),
    'guesses', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'player_id', q.player_id, 'position', q.position,
               'points', q.points) order by q.position, q.player_id), '[]'::jsonb)
      from public.wavelength_guesses q
      where q.room_id = g.room_id and q.round_no = g.round_no),
    'scores', (
      select coalesce(jsonb_object_agg(s.player_id, s.score), '{}'::jsonb)
      from public.wavelength_scores s where s.room_id = g.room_id),
    'history', (
      select coalesce(jsonb_agg(to_jsonb(h) - 'room_id' order by h.round_no),
                      '[]'::jsonb)
      from public.wavelength_history h where h.room_id = g.room_id)
  )
  from public.wavelength_games g
  where g.room_id = p_room_id
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table public.wavelength_settings enable row level security;
alter table public.wavelength_scores   enable row level security;

revoke all on public.wavelength_settings, public.wavelength_scores
from anon, authenticated;
grant select on public.wavelength_settings, public.wavelength_scores
to authenticated;

create policy "members can read the settings" on public.wavelength_settings
  for select to authenticated using (private.is_member(room_id));
create policy "members can read scores" on public.wavelength_scores
  for select to authenticated using (private.is_member(room_id));

revoke execute on function
  public.wavelength_lobby(uuid),
  public.wavelength_set_settings(uuid, boolean)
from public, anon;
grant execute on function
  public.wavelength_lobby(uuid),
  public.wavelength_set_settings(uuid, boolean)
to authenticated;
