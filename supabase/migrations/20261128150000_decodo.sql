-- "Decodo". Two teams each have four secret words, numbered 1 to 4. Each round,
-- one player per team gets a code of three of these numbers and writes a clue for
-- each. Their own team should work out the code; the other team tries to as well.
--
-- Secrecy: a team's words can only be read by that team, a code only by the
-- clue-giver, and guesses only by the guessing team, until the reveal.

insert into public.game_types (id, min_players, max_players)
values ('decodo', 4, 8);

-- ---------------------------------------------------------------------------
-- Tables. Teams are 0 ("Rot") and 1 ("Blau"). Arrays with one entry per team
-- are indexed with team + 1.
-- ---------------------------------------------------------------------------

create table private.decodo_words (
  word text primary key
);

-- Words a room has seen, across games.
create table private.decodo_used_words (
  room_id uuid not null references public.rooms (id) on delete cascade,
  word    text not null,
  primary key (room_id, word)
);

-- Who is in which team. Filled when people join; the host can change it.
create table public.decodo_members (
  room_id uuid not null,
  user_id uuid not null,
  team    int not null check (team in (0, 1)),
  primary key (room_id, user_id),
  foreign key (room_id, user_id)
    references public.players (room_id, user_id) on delete cascade
);

-- Everything in this table is public within the room.
create table public.decodo_games (
  room_id          uuid primary key references public.rooms (id) on delete cascade,
  phase            text not null check (phase in (
                     'writing', 'guessing', 'reveal', 'tiebreak', 'judging',
                     'game_over')),
  -- Counts every new screen, against stale and double taps.
  step             int not null default 0,
  round_no         int not null default 1,
  -- Whose code is next to be guessed. Rot goes first.
  turn             int not null default 0,
  -- The players of each team.
  red_ids          uuid[] not null,
  blue_ids         uuid[] not null,
  -- The order of clue-givers, including people who left.
  red_order        uuid[] not null,
  blue_order       uuid[] not null,
  red_encryptor    uuid not null,
  blue_encryptor   uuid not null,
  red_submitted    boolean not null default false,
  blue_submitted   boolean not null default false,
  -- Starts when the first clue-giver has submitted.
  timer_started_at timestamptz,
  -- Which guessing teams have locked their guess in.
  locked           boolean[] not null default '{false,false}',
  interceptions    int[] not null default '{0,0}',
  misses           int[] not null default '{0,0}',
  -- At the end: { winner: 0 | 1 | null, reason }
  outcome          jsonb,
  -- Both teams' words, once they are no longer secret.
  final_words      jsonb
);

-- The two secret word lists.
create table public.decodo_keywords (
  room_id uuid not null references public.rooms (id) on delete cascade,
  team    int not null,
  words   text[] not null,
  primary key (room_id, team)
);

-- This round's codes.
create table public.decodo_codes (
  room_id uuid not null references public.rooms (id) on delete cascade,
  team    int not null,
  code    int[] not null,
  primary key (room_id, team)
);

-- Submitted clues that haven't been revealed yet.
create table public.decodo_pending (
  room_id uuid not null references public.rooms (id) on delete cascade,
  team    int not null,
  clues   text[] not null,
  primary key (room_id, team)
);

-- The note sheet: every revealed set of clues. The code and the guesses are
-- added when they are revealed.
create table public.decodo_clues (
  room_id     uuid not null references public.rooms (id) on delete cascade,
  round_no    int not null,
  team        int not null,
  clues       text[] not null,
  code        int[],
  own_guess   int[],
  other_guess int[],
  primary key (room_id, round_no, team)
);

-- The guess each team is working on. 0 means not chosen yet.
create table public.decodo_guesses (
  room_id uuid not null references public.rooms (id) on delete cascade,
  team    int not null,
  digits  int[] not null default '{0,0,0}',
  primary key (room_id, team)
);

-- Tie: what each team thinks the other team's words are, and which of those
-- guesses the other team counts as correct.
create table public.decodo_tiebreak (
  room_id uuid not null references public.rooms (id) on delete cascade,
  team    int not null,
  guesses text[] not null,
  marks   boolean[],
  primary key (room_id, team)
);

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Puts newcomers into the smaller team, at random if both are equal.
create function private.decodo_player_added() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_red  int;
  v_blue int;
begin
  if not exists (select 1 from public.rooms
                 where id = new.room_id and game_type = 'decodo') then
    return null;
  end if;
  select count(*) filter (where team = 0), count(*) filter (where team = 1)
  into v_red, v_blue
  from public.decodo_members where room_id = new.room_id;
  insert into public.decodo_members (room_id, user_id, team)
  values (new.room_id, new.user_id,
          case when v_red < v_blue then 0
               when v_blue < v_red then 1
               else floor(random() * 2)::int end);
  return null;
end $$;

create trigger decodo_player_added
after insert on public.players
for each row execute function private.decodo_player_added();

create function private.decodo_team(p_game public.decodo_games, p_user uuid)
returns int
language sql immutable set search_path = '' as $$
  select case when p_user = any (p_game.red_ids) then 0
              when p_user = any (p_game.blue_ids) then 1 end
$$;

create function private.decodo_ids(p_game public.decodo_games, p_team int)
returns uuid[]
language sql immutable set search_path = '' as $$
  select case p_team when 0 then p_game.red_ids else p_game.blue_ids end
$$;

create function private.decodo_encryptor(p_game public.decodo_games, p_team int)
returns uuid
language sql immutable set search_path = '' as $$
  select case p_team when 0 then p_game.red_encryptor
                     else p_game.blue_encryptor end
$$;

-- The next player after p_from, in clue-giving order, who is still in the team.
-- With p_online, people who are offline are passed over if possible.
create function private.decodo_next_encryptor(
  p_room_id uuid, p_team int, p_from uuid, p_online boolean default false)
returns uuid
language sql stable set search_path = '' as $$
  with g as (
    select case p_team when 0 then red_order else blue_order end as turns,
           case p_team when 0 then red_ids else blue_ids end as ids
    from public.decodo_games where room_id = p_room_id
  )
  select u.id
  from g
  cross join unnest(g.turns) with ordinality u(id, i)
  where u.id = any (g.ids) and u.id <> p_from
  order by p_online and private.is_stale(p_room_id, u.id),
           (u.i - coalesce(array_position(g.turns, p_from), 0)
              + cardinality(g.turns)) % cardinality(g.turns)
  limit 1
$$;

-- Gives a team's clue-giver a new code: three different numbers from 1 to 4.
create function private.decodo_new_code(p_room_id uuid, p_team int)
returns void
language sql set search_path = '' as $$
  insert into public.decodo_codes (room_id, team, code)
  select p_room_id, p_team, (array_agg(n order by random()))[1:3]
  from generate_series(1, 4) n
  on conflict (room_id, team) do update set code = excluded.code
$$;

-- Has this team's clue set of the current round been shown?
create function private.decodo_revealed(p_room_id uuid, p_team int)
returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.decodo_clues c
    join public.decodo_games g on g.room_id = c.room_id
      and g.round_no = c.round_no
    where c.room_id = p_room_id and c.team = p_team)
$$;

create function private.decodo_new_round(p_room_id uuid, p_round_no int)
returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.decodo_pending where room_id = p_room_id;
  delete from public.decodo_guesses where room_id = p_room_id;
  update public.decodo_games set
    phase = 'writing',
    step = step + 1,
    round_no = p_round_no,
    turn = 0,
    red_submitted = false,
    blue_submitted = false,
    timer_started_at = null,
    locked = '{false,false}'
  where room_id = p_room_id;
  perform private.decodo_new_code(p_room_id, 0);
  perform private.decodo_new_code(p_room_id, 1);
end $$;

-- Shows the clues of the team whose turn it is, and opens the guessing.
create function private.decodo_start_turn(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game public.decodo_games;
begin
  select * into v_game from public.decodo_games where room_id = p_room_id;
  insert into public.decodo_clues (room_id, round_no, team, clues)
  select p_room_id, v_game.round_no, v_game.turn, p.clues
  from public.decodo_pending p
  where p.room_id = p_room_id and p.team = v_game.turn;
  delete from public.decodo_pending
  where room_id = p_room_id and team = v_game.turn;
  delete from public.decodo_guesses where room_id = p_room_id;
  insert into public.decodo_guesses (room_id, team)
  values (p_room_id, 0), (p_room_id, 1);
  update public.decodo_games set
    phase = 'guessing',
    step = step + 1,
    timer_started_at = null,
    locked = '{false,false}'
  where room_id = p_room_id;
end $$;

-- Once every clue set that is still hidden has been written, guessing starts.
create function private.decodo_check_written(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game public.decodo_games;
begin
  select * into v_game from public.decodo_games where room_id = p_room_id;
  if v_game.phase = 'writing'
     and v_game.red_submitted and v_game.blue_submitted then
    perform private.decodo_start_turn(p_room_id);
  end if;
end $$;

-- Reveals the code once every team that has to guess has locked in, and hands
-- out the tokens. In round 1, nobody intercepts.
create function private.decodo_check_locked(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game  public.decodo_games;
  v_code  int[];
  v_own   int[];
  v_other int[];
  v_team  int;
begin
  select * into v_game from public.decodo_games where room_id = p_room_id;
  v_team := v_game.turn;
  if v_game.phase <> 'guessing'
     or not v_game.locked[v_team + 1]
     or (v_game.round_no > 1 and not v_game.locked[2 - v_team]) then
    return;
  end if;

  select code into v_code from public.decodo_codes
  where room_id = p_room_id and team = v_team;
  -- A guess that was never made (nobody was there to make it) stays empty.
  select nullif(digits, '{0,0,0}') into v_own from public.decodo_guesses
  where room_id = p_room_id and team = v_team;
  if v_game.round_no > 1 then
    select nullif(digits, '{0,0,0}') into v_other from public.decodo_guesses
    where room_id = p_room_id and team = 1 - v_team;
  end if;

  if v_own is distinct from v_code then
    v_game.misses[v_team + 1] := v_game.misses[v_team + 1] + 1;
  end if;
  if v_other = v_code then
    v_game.interceptions[2 - v_team] := v_game.interceptions[2 - v_team] + 1;
  end if;

  update public.decodo_clues
  set code = v_code, own_guess = v_own, other_guess = v_other
  where room_id = p_room_id and round_no = v_game.round_no and team = v_team;
  update public.decodo_games set
    phase = 'reveal',
    step = step + 1,
    misses = v_game.misses,
    interceptions = v_game.interceptions
  where room_id = p_room_id;
end $$;

create function private.decodo_all_words(p_room_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_agg(to_jsonb(words) order by team)
  from public.decodo_keywords where room_id = p_room_id
$$;

create function private.decodo_finish(
  p_room_id uuid, p_winner int, p_reason text)
returns void
language sql set search_path = '' as $$
  update public.decodo_games set
    phase = 'game_over',
    step = step + 1,
    outcome = jsonb_build_object('winner', p_winner, 'reason', p_reason),
    final_words = private.decodo_all_words(p_room_id)
  where room_id = p_room_id;
  update public.rooms set status = 'finished' where id = p_room_id;
$$;

-- After both codes of a round: is the game decided?
create function private.decodo_end_of_round(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game     public.decodo_games;
  v_won      boolean[];
  v_lost     boolean[];
  v_red      int;
  v_blue     int;
begin
  select * into v_game from public.decodo_games where room_id = p_room_id;
  v_won := array[v_game.interceptions[1] >= 2, v_game.interceptions[2] >= 2];
  v_lost := array[v_game.misses[1] >= 2, v_game.misses[2] >= 2];

  if not (v_won[1] or v_won[2] or v_lost[1] or v_lost[2])
     and v_game.round_no < 8 then
    perform private.decodo_new_round(p_room_id, v_game.round_no + 1);
    -- The next player in each team gives the clues.
    update public.decodo_games set
      red_encryptor =
        private.decodo_next_encryptor(p_room_id, 0, v_game.red_encryptor),
      blue_encryptor =
        private.decodo_next_encryptor(p_room_id, 1, v_game.blue_encryptor)
    where room_id = p_room_id;
    return;
  end if;

  -- One clear result, unless one of the tie conditions applies.
  if (v_won[1] or v_won[2] or v_lost[1] or v_lost[2])
     and not (v_won[1] and v_lost[1]) and not (v_won[2] and v_lost[2])
     and not (v_won[1] and v_won[2]) and not (v_lost[1] and v_lost[2]) then
    perform private.decodo_finish(
      p_room_id,
      case when v_won[1] or v_lost[2] then 0 else 1 end,
      case when v_won[1] or v_won[2] then 'interceptions' else 'misses' end);
    return;
  end if;

  -- A tie: +1 for every interception, -1 for every miscommunication.
  v_red := v_game.interceptions[1] - v_game.misses[1];
  v_blue := v_game.interceptions[2] - v_game.misses[2];
  if v_red <> v_blue then
    perform private.decodo_finish(
      p_room_id, case when v_red > v_blue then 0 else 1 end, 'points');
  else
    update public.decodo_games set phase = 'tiebreak', step = step + 1
    where room_id = p_room_id;
  end if;
end $$;

-- Common checks for every in-game action. p_step guards against stale or double
-- clicks.
create function private.decodo_action(
  p_room_id uuid, p_step int, p_phases text[])
returns public.decodo_games
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
  v_game public.decodo_games;
begin
  select * into v_game from public.decodo_games where room_id = p_room_id;
  if not found or v_room.status <> 'playing'
     or v_game.step <> p_step
     or v_game.phase <> all (p_phases) then
    raise exception 'wrong_phase';
  end if;
  if private.decodo_team(v_game, auth.uid()) is null then
    raise exception 'wrong_role';
  end if;
  return v_game;
end $$;

-- Whether somebody may work on and lock in this team's guess: everyone in the
-- team, except the clue-giver for their own code. Nobody intercepts in round 1.
create function private.decodo_may_guess(
  p_game public.decodo_games, p_team int, p_user uuid)
returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    p_user = any (private.decodo_ids(p_game, p_team))
    and case when p_team = p_game.turn
             then p_user <> private.decodo_encryptor(p_game, p_team)
             else p_game.round_no > 1 end, false)
$$;

-- ---------------------------------------------------------------------------
-- Lobby
-- ---------------------------------------------------------------------------

-- Who is in which team. Runs with the caller's rights.
create function public.decodo_lobby(p_room_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(m.user_id, m.team), '{}'::jsonb)
  from public.decodo_members m where m.room_id = p_room_id
$$;

create function public.decodo_set_team(
  p_room_id uuid, p_user_id uuid, p_team int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'decodo' then
    raise exception 'wrong_phase';
  end if;
  if p_team is null or p_team not in (0, 1) then
    raise exception 'invalid_action';
  end if;
  update public.decodo_members set team = p_team
  where room_id = p_room_id and user_id = p_user_id;
  if not found then
    raise exception 'players_changed';
  end if;
  perform private.touch(p_room_id);
end $$;

-- New random teams of equal size, or off by one.
create function public.decodo_shuffle_teams(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms := private.lock_room(p_room_id);
  v_first int := floor(random() * 2)::int;
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'decodo' then
    raise exception 'wrong_phase';
  end if;
  update public.decodo_members m set team = (s.i + v_first) % 2
  from (select user_id, (row_number() over (order by random()))::int as i
        from public.decodo_members where room_id = p_room_id) s
  where m.room_id = p_room_id and m.user_id = s.user_id;
  perform private.touch(p_room_id);
end $$;

-- ---------------------------------------------------------------------------
-- Game functions (callable by clients)
-- ---------------------------------------------------------------------------

create function public.decodo_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms := private.lock_room(p_room_id);
  v_red   uuid[];
  v_blue  uuid[];
  v_words text[];
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'decodo' then
    raise exception 'wrong_phase';
  end if;
  -- Each team in seating order.
  select coalesce(array_agg(m.user_id order by p.seat_order)
                    filter (where m.team = 0), '{}'),
         coalesce(array_agg(m.user_id order by p.seat_order)
                    filter (where m.team = 1), '{}')
  into v_red, v_blue
  from public.decodo_members m
  join public.players p using (room_id, user_id)
  where m.room_id = p_room_id;
  if cardinality(v_red) + cardinality(v_blue) < 4 then
    raise exception 'not_enough_players';
  end if;
  if least(cardinality(v_red), cardinality(v_blue)) < 2
     or abs(cardinality(v_red) - cardinality(v_blue)) > 1 then
    raise exception 'uneven_teams';
  end if;

  delete from public.decodo_games    where room_id = p_room_id;
  delete from public.decodo_keywords where room_id = p_room_id;
  delete from public.decodo_clues    where room_id = p_room_id;
  delete from public.decodo_tiebreak where room_id = p_room_id;

  -- Eight words this room hasn't had yet.
  if (select count(*) from private.decodo_words w
      where not exists (select 1 from private.decodo_used_words u
                        where u.room_id = p_room_id and u.word = w.word)) < 8 then
    delete from private.decodo_used_words where room_id = p_room_id;
  end if;
  select array_agg(word) into v_words from (
    select w.word from private.decodo_words w
    where not exists (select 1 from private.decodo_used_words u
                      where u.room_id = p_room_id and u.word = w.word)
    order by random() limit 8) picked;
  insert into private.decodo_used_words (room_id, word)
  select p_room_id, unnest(v_words);
  insert into public.decodo_keywords (room_id, team, words)
  values (p_room_id, 0, v_words[1:4]), (p_room_id, 1, v_words[5:8]);

  insert into public.decodo_games
    (room_id, phase, red_ids, blue_ids, red_order, blue_order,
     red_encryptor, blue_encryptor)
  values
    (p_room_id, 'writing', v_red, v_blue, v_red, v_blue,
     v_red[1 + floor(random() * cardinality(v_red))::int],
     v_blue[1 + floor(random() * cardinality(v_blue))::int]);
  perform private.decodo_new_round(p_room_id, 1);

  update public.rooms set status = 'playing', open_to_join = false
  where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- The clue-giver's three clues. Can be changed until both teams' are in.
create function public.decodo_submit(
  p_room_id uuid, p_step int, p_clues text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game  public.decodo_games :=
            private.decodo_action(p_room_id, p_step, array['writing']);
  v_team  int := private.decodo_team(v_game, auth.uid());
  v_clues text[];
  v_norms text[];
begin
  if private.decodo_encryptor(v_game, v_team) <> auth.uid()
     or private.decodo_revealed(p_room_id, v_team) then
    raise exception 'wrong_role';
  end if;
  if cardinality(p_clues) is distinct from 3 then
    raise exception 'invalid_action';
  end if;
  select array_agg(btrim(regexp_replace(coalesce(c, ''), '\s+', ' ', 'g'))
                   order by i)
  into v_clues
  from unnest(p_clues) with ordinality u(c, i);
  if exists (select 1 from unnest(v_clues) c
             where char_length(c) not between 1 and 60) then
    raise exception 'decodo_invalid_clue';
  end if;
  select array_agg(private.dito_normalize(c)) into v_norms
  from unnest(v_clues) c;

  -- Only the own words: checking the other team's would give them away.
  if exists (select 1 from public.decodo_keywords k
             cross join unnest(k.words) w
             where k.room_id = p_room_id and k.team = v_team
               and private.dito_normalize(w) = any (v_norms)) then
    raise exception 'clue_is_keyword';
  end if;
  if (select count(distinct n) from unnest(v_norms) n) <> 3
     or exists (select 1 from public.decodo_clues h
                cross join unnest(h.clues) c
                where h.room_id = p_room_id and h.team = v_team
                  and private.dito_normalize(c) = any (v_norms)) then
    raise exception 'repeated_clue';
  end if;

  insert into public.decodo_pending (room_id, team, clues)
  values (p_room_id, v_team, v_clues)
  on conflict (room_id, team) do update set clues = excluded.clues;
  update public.decodo_games set
    red_submitted = red_submitted or v_team = 0,
    blue_submitted = blue_submitted or v_team = 1,
    timer_started_at = coalesce(timer_started_at, clock_timestamp())
  where room_id = p_room_id;
  perform private.decodo_check_written(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- Puts a number into one place of the own team's guess (0 empties it). A number
-- can only be used once, so it moves from where it was.
create function public.decodo_pick(
  p_room_id uuid, p_step int, p_position int, p_digit int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game   public.decodo_games :=
             private.decodo_action(p_room_id, p_step, array['guessing']);
  v_team   int := private.decodo_team(v_game, auth.uid());
  v_digits int[];
begin
  if not private.decodo_may_guess(v_game, v_team, auth.uid()) then
    raise exception 'wrong_role';
  end if;
  if v_game.locked[v_team + 1] then
    raise exception 'guess_locked';
  end if;
  if p_position is null or p_position not between 1 and 3
     or p_digit is null or p_digit not between 0 and 4 then
    raise exception 'invalid_action';
  end if;
  select array_agg(case when i = p_position then p_digit
                        when d = p_digit then 0
                        else d end order by i)
  into v_digits
  from public.decodo_guesses g
  cross join unnest(g.digits) with ordinality u(d, i)
  where g.room_id = p_room_id and g.team = v_team;
  update public.decodo_guesses set digits = v_digits
  where room_id = p_room_id and team = v_team;
  perform private.touch(p_room_id);
end $$;

-- Locks in the team's guess. p_digits is what the caller sees, so a last-second
-- change by a teammate isn't locked in unseen.
create function public.decodo_lock(p_room_id uuid, p_step int, p_digits int[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game   public.decodo_games :=
             private.decodo_action(p_room_id, p_step, array['guessing']);
  v_team   int := private.decodo_team(v_game, auth.uid());
  v_digits int[];
begin
  if not private.decodo_may_guess(v_game, v_team, auth.uid()) then
    raise exception 'wrong_role';
  end if;
  if v_game.locked[v_team + 1] then
    raise exception 'guess_locked';
  end if;
  select digits into v_digits from public.decodo_guesses
  where room_id = p_room_id and team = v_team;
  if v_digits is distinct from p_digits then
    raise exception 'guess_changed';
  end if;
  if 0 = any (v_digits) then
    raise exception 'guess_incomplete';
  end if;
  v_game.locked[v_team + 1] := true;
  update public.decodo_games set locked = v_game.locked
  where room_id = p_room_id;
  perform private.decodo_check_locked(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- Host tool: if nobody who may guess for a team is online, goes on without that
-- guess. Without a guess of its own, the team miscommunicates.
create function public.decodo_skip_guess(
  p_room_id uuid, p_step int, p_team int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.decodo_games :=
           private.decodo_action(p_room_id, p_step, array['guessing']);
begin
  perform private.require_host(p_room_id);
  if p_team is null or p_team not in (0, 1) or v_game.locked[p_team + 1]
     or (p_team <> v_game.turn and v_game.round_no = 1) then
    raise exception 'invalid_action';
  end if;
  if exists (select 1 from unnest(private.decodo_ids(v_game, p_team)) p
             where private.decodo_may_guess(v_game, p_team, p)
               and (p = auth.uid() or not private.is_stale(p_room_id, p))) then
    raise exception 'players_still_here';
  end if;
  update public.decodo_guesses set digits = '{0,0,0}'
  where room_id = p_room_id and team = p_team;
  v_game.locked[p_team + 1] := true;
  update public.decodo_games set locked = v_game.locked
  where room_id = p_room_id;
  perform private.decodo_check_locked(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- From the reveal to the other team's code, or to the end of the round. For the
-- host and for the clue-giver whose code was just shown.
create function public.decodo_next(p_room_id uuid, p_step int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.decodo_games :=
           private.decodo_action(p_room_id, p_step, array['reveal']);
begin
  if private.decodo_encryptor(v_game, v_game.turn) <> auth.uid() then
    perform private.require_host(p_room_id);
  end if;
  if v_game.turn = 0 then
    update public.decodo_games
    set turn = 1, phase = 'writing', step = step + 1, timer_started_at = null
    where room_id = p_room_id;
    -- Normally Blau's clues are in already, and guessing starts right away.
    perform private.decodo_check_written(p_room_id);
  else
    perform private.decodo_end_of_round(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Host tool: if a clue-giver is offline before their clues are shown, a teammate
-- takes over, with a new code.
create function public.decodo_replace_encryptor(
  p_room_id uuid, p_step int, p_team int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.decodo_games := private.decodo_action(
           p_room_id, p_step, array['writing', 'guessing', 'reveal']);
  v_old  uuid;
  v_new  uuid;
begin
  perform private.require_host(p_room_id);
  if p_team is null or p_team not in (0, 1)
     or private.decodo_revealed(p_room_id, p_team) then
    raise exception 'invalid_action';
  end if;
  v_old := private.decodo_encryptor(v_game, p_team);
  if v_old = auth.uid() or not private.is_stale(p_room_id, v_old) then
    raise exception 'players_still_here';
  end if;
  v_new := private.decodo_next_encryptor(p_room_id, p_team, v_old, true);

  delete from public.decodo_pending where room_id = p_room_id and team = p_team;
  perform private.decodo_new_code(p_room_id, p_team);
  update public.decodo_games set
    red_encryptor = case when p_team = 0 then v_new else red_encryptor end,
    blue_encryptor = case when p_team = 1 then v_new else blue_encryptor end,
    red_submitted = red_submitted and p_team <> 0,
    blue_submitted = blue_submitted and p_team <> 1,
    -- If the other team is done, the 30 seconds start again.
    timer_started_at = case
      when (p_team = 0 and blue_submitted) or (p_team = 1 and red_submitted)
      then clock_timestamp() end
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Tie: each team names the other team's four words.
create function public.decodo_tiebreak_guess(
  p_room_id uuid, p_step int, p_guesses text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game    public.decodo_games :=
              private.decodo_action(p_room_id, p_step, array['tiebreak']);
  v_team    int := private.decodo_team(v_game, auth.uid());
  v_guesses text[];
begin
  if cardinality(p_guesses) is distinct from 4 then
    raise exception 'invalid_action';
  end if;
  select array_agg(btrim(regexp_replace(coalesce(w, ''), '\s+', ' ', 'g'))
                   order by i)
  into v_guesses
  from unnest(p_guesses) with ordinality u(w, i);
  if exists (select 1 from unnest(v_guesses) w
             where char_length(w) not between 1 and 40) then
    raise exception 'decodo_invalid_word';
  end if;
  -- Naming a word twice must not count twice.
  if (select count(distinct private.dito_normalize(w))
      from unnest(v_guesses) w) <> 4 then
    raise exception 'repeated_word';
  end if;

  insert into public.decodo_tiebreak (room_id, team, guesses)
  values (p_room_id, v_team, v_guesses)
  on conflict (room_id, team) do update set guesses = excluded.guesses;
  if (select count(*) from public.decodo_tiebreak
      where room_id = p_room_id) = 2 then
    update public.decodo_games set
      phase = 'judging',
      step = step + 1,
      final_words = private.decodo_all_words(p_room_id)
    where room_id = p_room_id;
  end if;
  perform private.touch(p_room_id);
end $$;

-- Each team marks which of the other team's guesses name one of its own words.
create function public.decodo_judge(
  p_room_id uuid, p_step int, p_marks boolean[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.decodo_games :=
           private.decodo_action(p_room_id, p_step, array['judging']);
  v_team int := private.decodo_team(v_game, auth.uid());
  v_red  int;
  v_blue int;
begin
  if cardinality(p_marks) is distinct from 4
     or array_position(p_marks, null) is not null then
    raise exception 'invalid_action';
  end if;
  update public.decodo_tiebreak set marks = p_marks
  where room_id = p_room_id and team = 1 - v_team and marks is null;
  if not found then
    raise exception 'wrong_phase';
  end if;

  if not exists (select 1 from public.decodo_tiebreak
                 where room_id = p_room_id and marks is null) then
    select count(*) filter (where t.team = 0 and m),
           count(*) filter (where t.team = 1 and m)
    into v_red, v_blue
    from public.decodo_tiebreak t cross join unnest(t.marks) m
    where t.room_id = p_room_id;
    perform private.decodo_finish(
      p_room_id,
      case when v_red > v_blue then 0 when v_blue > v_red then 1 end,
      'words');
  end if;
  perform private.touch(p_room_id);
end $$;

-- Keeps a running game consistent when a player leaves or is kicked.
create function private.decodo_player_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.decodo_games;
  v_team int;
  v_new  uuid;
begin
  if not exists (select 1 from public.rooms
                 where id = old.room_id and status = 'playing') then
    return null;
  end if;
  select * into v_game from public.decodo_games where room_id = old.room_id;
  if not found then
    return null;
  end if;
  v_team := private.decodo_team(v_game, old.user_id);
  if v_team is null then
    return null;
  end if;

  update public.decodo_games set
    red_ids = array_remove(red_ids, old.user_id),
    blue_ids = array_remove(blue_ids, old.user_id)
  where room_id = old.room_id;

  if cardinality(private.decodo_ids(v_game, v_team)) - 1 < 2 then
    perform private.decodo_finish(old.room_id, null, 'left');
    return null;
  end if;

  -- A clue-giver who leaves before their clues are shown is replaced. Once the
  -- clues are out, they stay, and so does the code.
  if private.decodo_encryptor(v_game, v_team) = old.user_id
     and v_game.phase in ('writing', 'guessing', 'reveal')
     and not private.decodo_revealed(old.room_id, v_team) then
    v_new := private.decodo_next_encryptor(old.room_id, v_team, old.user_id, true);
    delete from public.decodo_pending
    where room_id = old.room_id and team = v_team;
    perform private.decodo_new_code(old.room_id, v_team);
    update public.decodo_games set
      red_encryptor = case when v_team = 0 then v_new else red_encryptor end,
      blue_encryptor = case when v_team = 1 then v_new else blue_encryptor end,
      red_submitted = red_submitted and v_team <> 0,
      blue_submitted = blue_submitted and v_team <> 1,
      timer_started_at = case
        when (v_team = 0 and blue_submitted) or (v_team = 1 and red_submitted)
        then clock_timestamp() end
    where room_id = old.room_id;
  end if;
  return null;
end $$;

create trigger decodo_player_removed
after delete on public.players
for each row execute function private.decodo_player_removed();

-- One consistent view of the game. Runs with the caller's rights, so RLS decides
-- what is in it.
create function public.decodo_snapshot(p_room_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select jsonb_build_object(
    'game', to_jsonb(g) - 'red_order' - 'blue_order' - 'timer_started_at',
    -- Counted by the database, so that phone clocks don't matter.
    'timer_left', case when g.phase = 'writing' and g.timer_started_at is not null
      then greatest(0, 30 - extract(epoch from
             clock_timestamp() - g.timer_started_at)) end,
    -- Only the caller's own team's words, code, clues and guess are readable.
    'words', (
      select to_jsonb(k.words) from public.decodo_keywords k
      where k.room_id = g.room_id),
    'code', (
      select to_jsonb(c.code) from public.decodo_codes c
      where c.room_id = g.room_id),
    'pending', (
      select to_jsonb(p.clues) from public.decodo_pending p
      where p.room_id = g.room_id),
    'guess', (
      select to_jsonb(d.digits) from public.decodo_guesses d
      where d.room_id = g.room_id),
    'history', (
      select coalesce(jsonb_agg(to_jsonb(h) - 'room_id'
                      order by h.round_no, h.team), '[]'::jsonb)
      from public.decodo_clues h where h.room_id = g.room_id),
    'tiebreak', (
      select coalesce(jsonb_agg(to_jsonb(t) - 'room_id' order by t.team),
                      '[]'::jsonb)
      from public.decodo_tiebreak t where t.room_id = g.room_id)
  )
  from public.decodo_games g
  where g.room_id = p_room_id
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

-- Row Level Security policies can't call other private functions, so the checks
-- below are written out.

alter table private.decodo_words      enable row level security;
alter table private.decodo_used_words enable row level security;
alter table public.decodo_members     enable row level security;
alter table public.decodo_games       enable row level security;
alter table public.decodo_keywords    enable row level security;
alter table public.decodo_codes       enable row level security;
alter table public.decodo_pending     enable row level security;
alter table public.decodo_clues       enable row level security;
alter table public.decodo_guesses     enable row level security;
alter table public.decodo_tiebreak    enable row level security;

revoke all on
  public.decodo_members, public.decodo_games, public.decodo_keywords,
  public.decodo_codes, public.decodo_pending, public.decodo_clues,
  public.decodo_guesses, public.decodo_tiebreak
from anon, authenticated;
grant select on
  public.decodo_members, public.decodo_games, public.decodo_keywords,
  public.decodo_codes, public.decodo_pending, public.decodo_clues,
  public.decodo_guesses, public.decodo_tiebreak
to authenticated;

create policy "members can read the teams" on public.decodo_members
  for select to authenticated using (private.is_member(room_id));
create policy "members can read the game" on public.decodo_games
  for select to authenticated using (private.is_member(room_id));
create policy "members can read revealed clues" on public.decodo_clues
  for select to authenticated using (private.is_member(room_id));

create policy "only the own team reads its words" on public.decodo_keywords
  for select to authenticated using (
    private.is_member(room_id) and exists (
      select 1 from public.decodo_games g
      where g.room_id = decodo_keywords.room_id
        and (select auth.uid()) = any (
              case decodo_keywords.team when 0 then g.red_ids
                                        else g.blue_ids end)));

create policy "only the clue-giver reads the code" on public.decodo_codes
  for select to authenticated using (
    private.is_member(room_id) and exists (
      select 1 from public.decodo_games g
      where g.room_id = decodo_codes.room_id
        and (select auth.uid()) =
              case decodo_codes.team when 0 then g.red_encryptor
                                     else g.blue_encryptor end));

create policy "only the clue-giver reads hidden clues" on public.decodo_pending
  for select to authenticated using (
    private.is_member(room_id) and exists (
      select 1 from public.decodo_games g
      where g.room_id = decodo_pending.room_id
        and (select auth.uid()) =
              case decodo_pending.team when 0 then g.red_encryptor
                                       else g.blue_encryptor end));

-- The guessing team, but not the clue-giver while their own code is guessed.
create policy "only the guessing team reads its guess" on public.decodo_guesses
  for select to authenticated using (
    private.is_member(room_id) and exists (
      select 1 from public.decodo_games g
      where g.room_id = decodo_guesses.room_id
        and (select auth.uid()) = any (
              case decodo_guesses.team when 0 then g.red_ids
                                       else g.blue_ids end)
        and not (g.turn = decodo_guesses.team and (select auth.uid()) =
              case decodo_guesses.team when 0 then g.red_encryptor
                                       else g.blue_encryptor end)));

-- Hidden from the other team until both have guessed.
create policy "tiebreak guesses stay hidden until both are in"
  on public.decodo_tiebreak
  for select to authenticated using (
    private.is_member(room_id) and exists (
      select 1 from public.decodo_games g
      where g.room_id = decodo_tiebreak.room_id
        and (g.phase <> 'tiebreak' or (select auth.uid()) = any (
              case decodo_tiebreak.team when 0 then g.red_ids
                                        else g.blue_ids end))));

revoke execute on function
  public.decodo_lobby(uuid),
  public.decodo_set_team(uuid, uuid, int),
  public.decodo_shuffle_teams(uuid),
  public.decodo_start(uuid),
  public.decodo_submit(uuid, int, text[]),
  public.decodo_pick(uuid, int, int, int),
  public.decodo_lock(uuid, int, int[]),
  public.decodo_skip_guess(uuid, int, int),
  public.decodo_next(uuid, int),
  public.decodo_replace_encryptor(uuid, int, int),
  public.decodo_tiebreak_guess(uuid, int, text[]),
  public.decodo_judge(uuid, int, boolean[]),
  public.decodo_snapshot(uuid)
from public, anon;

grant execute on function
  public.decodo_lobby(uuid),
  public.decodo_set_team(uuid, uuid, int),
  public.decodo_shuffle_teams(uuid),
  public.decodo_start(uuid),
  public.decodo_submit(uuid, int, text[]),
  public.decodo_pick(uuid, int, int, int),
  public.decodo_lock(uuid, int, int[]),
  public.decodo_skip_guess(uuid, int, int),
  public.decodo_next(uuid, int),
  public.decodo_replace_encryptor(uuid, int, int),
  public.decodo_tiebreak_guess(uuid, int, text[]),
  public.decodo_judge(uuid, int, boolean[]),
  public.decodo_snapshot(uuid)
to authenticated;

-- See 20261128000100_lock_down_private.sql.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid) to authenticated;
