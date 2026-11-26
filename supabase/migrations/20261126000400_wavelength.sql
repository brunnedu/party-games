-- Wavelength: cooperative. One player sees a hidden target on a scale between
-- two opposites and gives a clue; the others set a dial.

insert into public.game_types (id, min_players, max_players)
values ('wavelength', 2, 10);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table private.wavelength_pairs (
  left_label  text not null,
  right_label text not null,
  primary key (left_label, right_label)
);

-- Everything in this table is public within the room. Positions run from 0
-- (left end) to 100 (right end).
create table public.wavelength_games (
  room_id       uuid primary key references public.rooms (id) on delete cascade,
  phase         text not null check (phase in ('clue', 'guessing', 'reveal', 'game_over')),
  -- Counts every attempt, including skipped ones.
  round_no      int not null,
  rounds_played int not null default 0,
  rounds_total  int not null,
  points        numeric(6, 2) not null default 0,
  giver_id      uuid not null,
  giver_seat    int not null,
  left_label    text not null,
  right_label   text not null,
  -- null if the clue was only said out loud
  clue          text,
  mode          text not null default 'shared' check (mode in ('shared', 'individual')),
  dial          int not null default 50 check (dial between 0 and 100),
  -- Guessers who confirmed the shared dial, or submitted an individual guess.
  done_ids      uuid[] not null default '{}',
  -- Filled in at the reveal.
  target        int,
  round_points  numeric(4, 2),
  used_pairs    text[] not null default '{}'
);

-- One row per round, readable only by that round's clue-giver.
create table public.wavelength_targets (
  room_id  uuid not null references public.rooms (id) on delete cascade,
  round_no int not null,
  giver_id uuid not null,
  target   int not null check (target between 0 and 100),
  primary key (room_id, round_no)
);

create table public.wavelength_guesses (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  round_no  int not null,
  player_id uuid not null,
  position  int not null check (position between 0 and 100),
  -- Filled in at the reveal.
  points    int,
  primary key (room_id, round_no, player_id)
);

create table public.wavelength_history (
  room_id     uuid not null references public.rooms (id) on delete cascade,
  round_no    int not null,
  left_label  text not null,
  right_label text not null,
  clue        text,
  target      int not null,
  points      numeric(4, 2) not null,
  primary key (room_id, round_no)
);

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Scoring bands. Keep in sync with BANDS in src/games/wavelength/scoring.ts.
create function private.wavelength_score(p_position int, p_target int) returns int
language sql immutable set search_path = '' as $$
  select case
    when abs(p_position - p_target) <= 4 then 4
    when abs(p_position - p_target) <= 11 then 3
    when abs(p_position - p_target) <= 18 then 2
    else 0
  end
$$;

-- Starts a round with the next player (by seat) as clue-giver.
create function private.wavelength_new_round(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game  public.wavelength_games;
  v_giver public.players;
  v_pair  private.wavelength_pairs;
  v_used  text[];
begin
  select * into v_game from public.wavelength_games where room_id = p_room_id;
  v_used := v_game.used_pairs;

  select * into v_giver from public.players
  where room_id = p_room_id
  order by (seat_order <= v_game.giver_seat), seat_order
  limit 1;

  select * into v_pair from private.wavelength_pairs
  where left_label || '|' || right_label <> all (v_used)
  order by random() limit 1;
  if not found then
    v_used := '{}';
    select * into v_pair from private.wavelength_pairs order by random() limit 1;
  end if;

  update public.wavelength_games set
    phase = 'clue',
    round_no = v_game.round_no + 1,
    giver_id = v_giver.user_id,
    giver_seat = v_giver.seat_order,
    left_label = v_pair.left_label,
    right_label = v_pair.right_label,
    clue = null,
    dial = 50,
    done_ids = '{}',
    target = null,
    round_points = null,
    used_pairs = array_append(v_used, v_pair.left_label || '|' || v_pair.right_label)
  where room_id = p_room_id;

  -- Not right at the very edge, where half of the scoring area would be lost.
  insert into public.wavelength_targets (room_id, round_no, giver_id, target)
  values (p_room_id, v_game.round_no + 1, v_giver.user_id,
          3 + floor(random() * 95)::int);

  update public.rooms set open_to_join = false where id = p_room_id;
end $$;

-- Have all current guessers confirmed or submitted?
create function private.wavelength_all_done(p_room_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.players p
    join public.wavelength_games g on g.room_id = p.room_id
    where p.room_id = p_room_id
      and p.user_id <> g.giver_id
      and p.user_id <> all (g.done_ids))
$$;

create function private.wavelength_reveal(p_room_id uuid) returns void
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
    -- Cooperative: the round is worth the average of everyone's points.
    select coalesce(round(avg(points), 2), 0) into v_points
    from public.wavelength_guesses
    where room_id = p_room_id and round_no = v_game.round_no;
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

-- Common checks for every in-game action. p_round_no guards against stale or
-- double clicks. p_role is 'giver', 'guesser' or 'any'.
create function private.wavelength_action(
  p_room_id uuid, p_round_no int, p_phases text[], p_role text)
returns public.wavelength_games
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
  v_game public.wavelength_games;
begin
  select * into v_game from public.wavelength_games where room_id = p_room_id;
  if not found or v_room.status <> 'playing'
     or v_game.round_no <> p_round_no
     or v_game.phase <> all (p_phases) then
    raise exception 'wrong_phase';
  end if;
  if (p_role = 'giver' and v_game.giver_id <> auth.uid())
     or (p_role = 'guesser' and v_game.giver_id = auth.uid()) then
    raise exception 'wrong_role';
  end if;
  return v_game;
end $$;

create function private.require_host(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.rooms
                 where id = p_room_id and host_id = auth.uid()) then
    raise exception 'not_host';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Game functions (callable by clients)
-- ---------------------------------------------------------------------------

create function public.wavelength_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms := private.lock_room(p_room_id);
  v_count int;
  v_first public.players;
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'wavelength' then
    raise exception 'wrong_phase';
  end if;
  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < 2 then
    raise exception 'not_enough_players';
  end if;

  delete from public.wavelength_games   where room_id = p_room_id;
  delete from public.wavelength_targets where room_id = p_room_id;
  delete from public.wavelength_guesses where room_id = p_room_id;
  delete from public.wavelength_history where room_id = p_room_id;

  select * into v_first from public.players
  where room_id = p_room_id order by random() limit 1;

  -- A placeholder row; the first round goes to v_first. Everyone gives the same
  -- number of clues: 3 each for 2-3 players, 2 for 4-6, 1 for 7-10.
  insert into public.wavelength_games
    (room_id, phase, round_no, rounds_total, giver_id, giver_seat,
     left_label, right_label)
  values
    (p_room_id, 'clue', 0,
     v_count * case when v_count <= 3 then 3 when v_count <= 6 then 2 else 1 end,
     v_first.user_id, v_first.seat_order - 1, '', '');
  perform private.wavelength_new_round(p_room_id);

  update public.rooms set status = 'playing' where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- An empty clue means it was said out loud. The clue-giver picks how the others
-- guess; that is fixed from here on.
create function public.wavelength_give_clue(
  p_room_id uuid, p_round_no int, p_mode text, p_clue text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clue text := nullif(btrim(regexp_replace(coalesce(p_clue, ''), '\s+', ' ', 'g')), '');
begin
  perform private.wavelength_action(p_room_id, p_round_no, array['clue'], 'giver');
  if p_mode is null or p_mode not in ('shared', 'individual') then
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

-- Moving the shared dial. Confirmations only count for the position seen.
create function public.wavelength_move_dial(
  p_room_id uuid, p_round_no int, p_position int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.wavelength_games := private.wavelength_action(
    p_room_id, p_round_no, array['guessing'], 'guesser');
begin
  if v_game.mode <> 'shared' then
    raise exception 'wrong_phase';
  end if;
  if p_position is null or p_position not between 0 and 100 then
    raise exception 'invalid_position';
  end if;
  if p_position <> v_game.dial then
    update public.wavelength_games set dial = p_position, done_ids = '{}'
    where room_id = p_room_id;
    perform private.touch(p_room_id);
  end if;
end $$;

-- p_position is the dial position the player saw when confirming.
create function public.wavelength_confirm(
  p_room_id uuid, p_round_no int, p_position int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.wavelength_games := private.wavelength_action(
    p_room_id, p_round_no, array['guessing'], 'guesser');
begin
  if v_game.mode <> 'shared' then
    raise exception 'wrong_phase';
  end if;
  if p_position is distinct from v_game.dial then
    raise exception 'dial_moved';
  end if;
  update public.wavelength_games
  set done_ids = array_append(array_remove(done_ids, auth.uid()), auth.uid())
  where room_id = p_room_id;

  if private.wavelength_all_done(p_room_id) then
    perform private.wavelength_reveal(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- An individual guess, secret until everyone has submitted.
create function public.wavelength_submit_guess(
  p_room_id uuid, p_round_no int, p_position int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.wavelength_games := private.wavelength_action(
    p_room_id, p_round_no, array['guessing'], 'guesser');
begin
  if v_game.mode <> 'individual' then
    raise exception 'wrong_phase';
  end if;
  if p_position is null or p_position not between 0 and 100 then
    raise exception 'invalid_position';
  end if;

  insert into public.wavelength_guesses (room_id, round_no, player_id, position)
  values (p_room_id, p_round_no, auth.uid(), p_position)
  on conflict (room_id, round_no, player_id)
  do update set position = excluded.position;

  update public.wavelength_games
  set done_ids = array_append(array_remove(done_ids, auth.uid()), auth.uid())
  where room_id = p_room_id;

  if private.wavelength_all_done(p_room_id) then
    perform private.wavelength_reveal(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Host tool: reveal without people who are offline. Everyone online, including
-- a guessing host, must have confirmed or submitted.
create function public.wavelength_force_reveal(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.wavelength_games := private.wavelength_action(
    p_room_id, p_round_no, array['guessing'], 'any');
begin
  perform private.require_host(p_room_id);
  if exists (select 1 from public.players p
             where p.room_id = p_room_id
               and p.user_id <> v_game.giver_id
               and p.user_id <> all (v_game.done_ids)
               and (p.user_id = auth.uid()
                    or not private.is_stale(p_room_id, p.user_id))) then
    raise exception 'players_still_here';
  end if;
  if cardinality(v_game.done_ids) = 0 then
    raise exception 'no_guesses_yet';
  end if;
  perform private.wavelength_reveal(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- Host tool: replace a stuck round. It doesn't count towards the total.
create function public.wavelength_skip_round(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.wavelength_action(
    p_room_id, p_round_no, array['clue', 'guessing'], 'any');
  perform private.require_host(p_room_id);
  perform private.wavelength_new_round(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- Moves on after the reveal: the next round, or the final result.
create function public.wavelength_next_round(p_room_id uuid, p_round_no int)
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
    if (select count(*) from public.players where room_id = p_room_id) < 2 then
      raise exception 'not_enough_players';
    end if;
    perform private.wavelength_new_round(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Keeps a running game consistent when a player leaves or is kicked.
create function private.wavelength_player_removed() returns trigger
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

  if (select count(*) from public.players where room_id = old.room_id) < 2 then
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

create trigger wavelength_player_removed
after delete on public.players
for each row execute function private.wavelength_player_removed();

-- One consistent view of the game. Runs with the caller's rights, so RLS
-- decides what is in it: only the clue-giver gets the target before the reveal.
create function public.wavelength_snapshot(p_room_id uuid) returns jsonb
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

alter table private.wavelength_pairs    enable row level security;
alter table public.wavelength_games     enable row level security;
alter table public.wavelength_targets   enable row level security;
alter table public.wavelength_guesses   enable row level security;
alter table public.wavelength_history   enable row level security;

revoke all on
  public.wavelength_games, public.wavelength_targets,
  public.wavelength_guesses, public.wavelength_history
from anon, authenticated;
grant select on
  public.wavelength_games, public.wavelength_targets,
  public.wavelength_guesses, public.wavelength_history
to authenticated;

create policy "members can read the game" on public.wavelength_games
  for select to authenticated using (private.is_member(room_id));

create policy "members can read the history" on public.wavelength_history
  for select to authenticated using (private.is_member(room_id));

-- Everyone else learns the target from wavelength_games at the reveal.
create policy "only the clue-giver can read the target" on public.wavelength_targets
  for select to authenticated using (
    private.is_member(room_id) and giver_id = (select auth.uid()));

create policy "guesses are secret until the reveal" on public.wavelength_guesses
  for select to authenticated using (
    private.is_member(room_id)
    and (
      player_id = (select auth.uid())
      or exists (
        select 1 from public.wavelength_games g
        where g.room_id = wavelength_guesses.room_id
          and (wavelength_guesses.round_no < g.round_no
               or (wavelength_guesses.round_no = g.round_no
                   and g.phase in ('reveal', 'game_over')))
      )
    )
  );

revoke execute on function
  public.wavelength_start(uuid),
  public.wavelength_give_clue(uuid, int, text, text),
  public.wavelength_move_dial(uuid, int, int),
  public.wavelength_confirm(uuid, int, int),
  public.wavelength_submit_guess(uuid, int, int),
  public.wavelength_force_reveal(uuid, int),
  public.wavelength_skip_round(uuid, int),
  public.wavelength_next_round(uuid, int),
  public.wavelength_snapshot(uuid)
from public, anon;

grant execute on function
  public.wavelength_start(uuid),
  public.wavelength_give_clue(uuid, int, text, text),
  public.wavelength_move_dial(uuid, int, int),
  public.wavelength_confirm(uuid, int, int),
  public.wavelength_submit_guess(uuid, int, int),
  public.wavelength_force_reveal(uuid, int),
  public.wavelength_skip_round(uuid, int),
  public.wavelength_next_round(uuid, int),
  public.wavelength_snapshot(uuid)
to authenticated;
