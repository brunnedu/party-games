-- Liar's Dice. Bids are spoken at the table; the app rolls and hides the dice,
-- keeps the order, reveals everything on a doubt and takes dice away.

insert into public.game_types (id, min_players, max_players)
values ('liars-dice', 2, 10);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Chosen by the host in the lobby.
create table public.liars_settings (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  order_ids  uuid[] not null default '{}',
  start_dice int not null default 5 check (start_dice between 1 and 6)
);

-- Everything in this table is public within the room.
create table public.liars_games (
  room_id        uuid primary key references public.rooms (id) on delete cascade,
  phase          text not null check (phase in (
                   'rolling', 'bidding', 'revealed', 'game_over')),
  round_no       int not null,
  -- Seating order, fixed for the whole game (including players who are out).
  order_ids      uuid[] not null,
  -- { player_id: number of dice }
  dice_counts    jsonb not null,
  starter_id     uuid not null,
  rolled_ids     uuid[] not null default '{}',
  -- Players without dice, first one out first.
  eliminated_ids uuid[] not null default '{}',
  doubter_id     uuid,
  accused_id     uuid,
  -- Who loses a die; applied when the next round starts.
  verdict        text check (verdict in ('doubter_loses', 'accused_loses')),
  -- { player_id: [dice] }, only filled in once somebody doubts.
  revealed       jsonb
);

-- Players can only ever read their own dice.
create table public.liars_dice (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  round_no  int not null,
  player_id uuid not null,
  dice      int[] not null,
  primary key (room_id, round_no, player_id)
);

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function private.liars_count(p_counts jsonb, p_player uuid) returns int
language sql immutable set search_path = '' as $$
  select coalesce((p_counts ->> p_player::text)::int, 0)
$$;

create function private.liars_alive(p_order uuid[], p_counts jsonb)
returns uuid[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(p order by i), '{}')
  from unnest(p_order) with ordinality u(p, i)
  where private.liars_count(p_counts, p) > 0
$$;

-- The next player with dice after (p_step = 1) or before (p_step = -1) p_from.
-- p_from may itself be out of dice, but must be part of the order.
create function private.liars_neighbour(
  p_order uuid[], p_counts jsonb, p_from uuid, p_step int)
returns uuid
language plpgsql immutable set search_path = '' as $$
declare
  v_size  int := cardinality(p_order);
  v_start int := array_position(p_order, p_from);
  v_index int;
begin
  for k in 1..v_size - 1 loop
    v_index := ((v_start - 1 + p_step * k) % v_size + v_size) % v_size + 1;
    if private.liars_count(p_counts, p_order[v_index]) > 0 then
      return p_order[v_index];
    end if;
  end loop;
  return null;
end $$;

-- The saved order, without people who left and with newcomers at the end.
create function private.liars_lobby_order(p_room_id uuid) returns uuid[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(p.user_id order by
           array_position(s.order_ids, p.user_id) nulls last, p.seat_order), '{}')
  from public.players p
  left join public.liars_settings s on s.room_id = p.room_id
  where p.room_id = p_room_id
$$;

create function private.liars_new_round(p_room_id uuid, p_starter uuid)
returns void
language sql set search_path = '' as $$
  update public.liars_games set
    phase = 'rolling',
    round_no = round_no + 1,
    starter_id = p_starter,
    rolled_ids = '{}',
    doubter_id = null,
    accused_id = null,
    verdict = null,
    revealed = null
  where room_id = p_room_id;
  delete from public.liars_dice where room_id = p_room_id;
$$;

create function private.liars_end(p_room_id uuid) returns void
language sql set search_path = '' as $$
  update public.liars_games set phase = 'game_over' where room_id = p_room_id;
  update public.rooms set status = 'finished' where id = p_room_id;
$$;

-- Common checks for every in-game action. p_round_no guards against stale or
-- double clicks.
create function private.liars_action(
  p_room_id uuid, p_round_no int, p_phases text[])
returns public.liars_games
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
  v_game public.liars_games;
begin
  select * into v_game from public.liars_games where room_id = p_room_id;
  if not found or v_room.status <> 'playing'
     or v_game.round_no <> p_round_no
     or v_game.phase <> all (p_phases) then
    raise exception 'wrong_phase';
  end if;
  return v_game;
end $$;

-- The doubter or the host.
create function private.liars_require_judge(
  p_room_id uuid, p_doubter uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if p_doubter <> auth.uid() then
    perform private.require_host(p_room_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Lobby
-- ---------------------------------------------------------------------------

create function public.liars_lobby(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_room_id) then
    return null;
  end if;
  return jsonb_build_object(
    'order_ids', to_jsonb(private.liars_lobby_order(p_room_id)),
    'start_dice', coalesce(
      (select start_dice from public.liars_settings where room_id = p_room_id), 5));
end $$;

-- A null argument keeps the current value.
create function public.liars_set_settings(
  p_room_id uuid, p_order uuid[] default null, p_start_dice int default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms := private.lock_room(p_room_id);
  v_order uuid[];
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'liars-dice' then
    raise exception 'wrong_phase';
  end if;
  v_order := coalesce(p_order, private.liars_lobby_order(p_room_id));
  -- Exactly the players in the room, each once.
  if cardinality(v_order) <> (select count(*) from public.players
                              where room_id = p_room_id)
     or (select count(distinct p.user_id) from public.players p
         where p.room_id = p_room_id and p.user_id = any (v_order))
        <> cardinality(v_order) then
    raise exception 'players_changed';
  end if;
  if p_start_dice is not null and p_start_dice not between 1 and 6 then
    raise exception 'invalid_action';
  end if;

  insert into public.liars_settings as s (room_id, order_ids, start_dice)
  values (p_room_id, v_order, coalesce(p_start_dice, 5))
  on conflict (room_id) do update set
    order_ids = excluded.order_ids,
    start_dice = coalesce(p_start_dice, s.start_dice);
  perform private.touch(p_room_id);
end $$;

-- ---------------------------------------------------------------------------
-- Game functions (callable by clients)
-- ---------------------------------------------------------------------------

create function public.liars_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms := private.lock_room(p_room_id);
  v_order uuid[];
  v_dice  int;
  v_round int;
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'liars-dice' then
    raise exception 'wrong_phase';
  end if;
  v_order := private.liars_lobby_order(p_room_id);
  if cardinality(v_order) < 2 then
    raise exception 'not_enough_players';
  end if;
  v_dice := coalesce(
    (select start_dice from public.liars_settings where room_id = p_room_id), 5);

  delete from public.liars_games where room_id = p_room_id;
  delete from public.liars_dice  where room_id = p_room_id;

  insert into public.liars_games
    (room_id, phase, round_no, order_ids, dice_counts, starter_id)
  select p_room_id, 'rolling', 1, v_order,
         jsonb_object_agg(p, v_dice),
         v_order[1 + floor(random() * cardinality(v_order))::int]
  from unnest(v_order) p;

  update public.rooms set status = 'playing', open_to_join = false
  where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- The database rolls, so nobody can choose their numbers.
create function public.liars_roll(p_room_id uuid, p_round_no int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game  public.liars_games := private.liars_action(
            p_room_id, p_round_no, array['rolling']);
  v_count int := private.liars_count(v_game.dice_counts, auth.uid());
begin
  if v_count = 0 then
    raise exception 'wrong_role';
  end if;
  if auth.uid() = any (v_game.rolled_ids) then
    return;
  end if;

  insert into public.liars_dice (room_id, round_no, player_id, dice)
  select p_room_id, p_round_no, auth.uid(),
         array_agg(roll order by roll)
  from (select 1 + floor(random() * 6)::int as roll
        from generate_series(1, v_count)) rolls;

  update public.liars_games set
    rolled_ids = array_append(rolled_ids, auth.uid()),
    phase = case
      when private.liars_alive(order_ids, dice_counts)
           <@ array_append(rolled_ids, auth.uid()) then 'bidding'
      else 'rolling' end
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Doubting the bid of the player before you. Reveals all dice.
create function public.liars_doubt(p_room_id uuid, p_round_no int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.liars_games := private.liars_action(
    p_room_id, p_round_no, array['bidding']);
begin
  if private.liars_count(v_game.dice_counts, auth.uid()) = 0 then
    raise exception 'wrong_role';
  end if;
  update public.liars_games set
    phase = 'revealed',
    doubter_id = auth.uid(),
    accused_id = private.liars_neighbour(order_ids, dice_counts, auth.uid(), -1),
    revealed = (
      select jsonb_object_agg(d.player_id, to_jsonb(d.dice))
      from public.liars_dice d
      where d.room_id = p_room_id and d.round_no = p_round_no)
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Can be changed until the next round starts.
create function public.liars_set_verdict(
  p_room_id uuid, p_round_no int, p_verdict text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.liars_games := private.liars_action(
    p_room_id, p_round_no, array['revealed']);
begin
  perform private.liars_require_judge(p_room_id, v_game.doubter_id);
  if p_verdict is null or p_verdict not in ('doubter_loses', 'accused_loses') then
    raise exception 'invalid_action';
  end if;
  update public.liars_games set verdict = p_verdict where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Takes the die away and starts the next round, or ends the game. p_verdict is
-- the verdict the caller sees, so a late correction can't be skipped over.
create function public.liars_next_round(
  p_room_id uuid, p_round_no int, p_verdict text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game    public.liars_games := private.liars_action(
              p_room_id, p_round_no, array['revealed']);
  v_loser   uuid;
  v_left    int;
  v_counts  jsonb;
  v_starter uuid;
begin
  perform private.liars_require_judge(p_room_id, v_game.doubter_id);
  if v_game.verdict is null then
    raise exception 'no_verdict';
  end if;
  if v_game.verdict is distinct from p_verdict then
    raise exception 'verdict_changed';
  end if;

  v_loser := case v_game.verdict
    when 'doubter_loses' then v_game.doubter_id else v_game.accused_id end;
  v_left := private.liars_count(v_game.dice_counts, v_loser) - 1;
  v_counts := jsonb_set(v_game.dice_counts, array[v_loser::text], to_jsonb(v_left));

  update public.liars_games set
    dice_counts = v_counts,
    eliminated_ids = case when v_left = 0
      then array_append(eliminated_ids, v_loser) else eliminated_ids end
  where room_id = p_room_id;

  if cardinality(private.liars_alive(v_game.order_ids, v_counts)) < 2 then
    perform private.liars_end(p_room_id);
  else
    v_starter := case when v_left > 0 then v_loser
      else private.liars_neighbour(v_game.order_ids, v_counts, v_loser, 1) end;
    perform private.liars_new_round(p_room_id, v_starter);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Host tool: start the round over without anyone losing a die.
create function public.liars_reroll(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.liars_games := private.liars_action(
    p_room_id, p_round_no, array['rolling', 'bidding', 'revealed']);
begin
  perform private.require_host(p_room_id);
  perform private.liars_new_round(p_room_id, v_game.starter_id);
  perform private.touch(p_room_id);
end $$;

-- A player who leaves or is removed takes their dice along.
create function private.liars_player_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_game    public.liars_games;
  v_starter uuid;
  v_alive   uuid[];
  v_was_in  boolean;
begin
  if not exists (select 1 from public.rooms
                 where id = old.room_id and status = 'playing') then
    return null;
  end if;
  select * into v_game from public.liars_games where room_id = old.room_id;
  if not found or old.user_id <> all (v_game.order_ids) then
    return null;
  end if;

  v_was_in := private.liars_count(v_game.dice_counts, old.user_id) > 0;
  v_starter := v_game.starter_id;
  if v_starter = old.user_id then
    v_starter := private.liars_neighbour(
      v_game.order_ids, v_game.dice_counts, old.user_id, 1);
  end if;
  v_game.order_ids := array_remove(v_game.order_ids, old.user_id);
  v_game.dice_counts := v_game.dice_counts - old.user_id::text;

  update public.liars_games set
    order_ids = v_game.order_ids,
    dice_counts = v_game.dice_counts,
    eliminated_ids = array_remove(eliminated_ids, old.user_id),
    rolled_ids = array_remove(rolled_ids, old.user_id),
    starter_id = coalesce(v_starter, starter_id)
  where room_id = old.room_id;

  -- Somebody who was already out changes nothing.
  if not v_was_in then
    return null;
  end if;

  v_alive := private.liars_alive(v_game.order_ids, v_game.dice_counts);
  if cardinality(v_alive) < 2 then
    perform private.liars_end(old.room_id);
  else
    perform private.liars_new_round(old.room_id, v_starter);
  end if;
  return null;
end $$;

create trigger liars_player_removed
after delete on public.players
for each row execute function private.liars_player_removed();

-- One consistent view of the game. Runs with the caller's rights, so RLS
-- decides what is in it: only your own dice until somebody doubts.
create function public.liars_snapshot(p_room_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'game', to_jsonb(g),
    'own_dice', (
      select to_jsonb(d.dice) from public.liars_dice d
      where d.room_id = g.room_id and d.round_no = g.round_no
        and d.player_id = (select auth.uid()))
  )
  from public.liars_games g
  where g.room_id = p_room_id
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table public.liars_settings enable row level security;
alter table public.liars_games    enable row level security;
alter table public.liars_dice     enable row level security;

revoke all on public.liars_settings, public.liars_games, public.liars_dice
  from anon, authenticated;
grant select on public.liars_settings, public.liars_games, public.liars_dice
  to authenticated;

create policy "members can read the settings" on public.liars_settings
  for select to authenticated using (private.is_member(room_id));
create policy "members can read the game" on public.liars_games
  for select to authenticated using (private.is_member(room_id));
create policy "players can read only their own dice" on public.liars_dice
  for select to authenticated using (
    private.is_member(room_id) and player_id = (select auth.uid()));

revoke execute on function
  public.liars_lobby(uuid),
  public.liars_set_settings(uuid, uuid[], int),
  public.liars_start(uuid),
  public.liars_roll(uuid, int),
  public.liars_doubt(uuid, int),
  public.liars_set_verdict(uuid, int, text),
  public.liars_next_round(uuid, int, text),
  public.liars_reroll(uuid, int),
  public.liars_snapshot(uuid)
from public, anon;

grant execute on function
  public.liars_lobby(uuid),
  public.liars_set_settings(uuid, uuid[], int),
  public.liars_start(uuid),
  public.liars_roll(uuid, int),
  public.liars_doubt(uuid, int),
  public.liars_set_verdict(uuid, int, text),
  public.liars_next_round(uuid, int, text),
  public.liars_reroll(uuid, int),
  public.liars_snapshot(uuid)
to authenticated;
