-- "Dito!", after the game by Martin Ang. In each of three rounds, everyone writes
-- three answers to each of three categories into a 3x3 grid. Then the players
-- take turns reading one of their answers; whoever has the same one circles it.
--
-- The database finds identical answers. Synonyms, plurals and typos are claimed
-- by the players themselves; the others can object, and then there is a vote.
--
-- Secrecy: players can only read their own grid until the round is over. What is
-- read or claimed during the reveal is copied into a public table.

insert into public.game_types (id, min_players, max_players)
values ('dito', 3, 10);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table private.dito_cards (
  category_a text primary key,
  category_b text not null
);

-- Cards a room has seen, across games.
create table private.dito_used_cards (
  room_id uuid not null references public.rooms (id) on delete cascade,
  card    text not null,
  primary key (room_id, card)
);

-- Chosen by the host in the lobby.
create table public.dito_settings (
  room_id   uuid primary key references public.rooms (id) on delete cascade,
  order_ids uuid[] not null default '{}'
);

-- Everything in this table is public within the room.
create table public.dito_games (
  room_id       uuid primary key references public.rooms (id) on delete cascade,
  phase         text not null check (phase in (
                  'choosing', 'writing', 'reveal', 'round_end', 'game_over')),
  -- Counts every new screen, against stale and double taps.
  step          int not null default 0,
  round_no      int not null default 1,
  category_no   int not null default 1,
  -- Seating order, without people who left.
  order_ids     uuid[] not null,
  -- With exactly three players at the start of a round, a star is worth less.
  three_players boolean not null default false,
  chooser_id    uuid not null,
  -- The categories chosen in this round so far.
  categories    text[] not null default '{}',
  submitted_ids uuid[] not null default '{}',
  reader_id     uuid,
  -- The cell the reader reads; null while they are choosing one.
  read_cell     int,
  -- Counts every change to the claims, so "Weiter" can't accept an unseen one.
  revision      int not null default 0,
  changed_at    timestamptz,
  -- { no, target_id, by_id, voted_ids, opened_at }
  objection     jsonb,
  objections    int not null default 0,
  -- { player_id: number of open answers }, during the reveal.
  open_counts   jsonb not null default '{}',
  -- How the previous reading ended.
  last_reading  jsonb,
  -- { player_id: { cells, circles, stars, star_points, bonus, points } }
  summary       jsonb
);

-- The two categories on the card, for the player who picks one.
create table public.dito_choices (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  chooser_id uuid not null,
  options    text[] not null
);

-- The grids of the current round. Cells are numbered 0..8, row by row.
create table public.dito_answers (
  room_id     uuid not null references public.rooms (id) on delete cascade,
  player_id   uuid not null,
  cell        int not null check (cell between 0 and 8),
  category_no int not null,
  answer      text not null,
  norm        text not null,
  state       text not null default 'open'
                check (state in ('open', 'circled', 'crossed')),
  star        boolean not null default false,
  primary key (room_id, player_id, cell)
);

-- The current reading: one row per player. The reader's row holds the cell being
-- read. "cell" is what gets circled, "also" are the player's other answers that
-- mean the same and get crossed out. "auto_cell" is what the app preselected.
create table public.dito_claims (
  room_id     uuid not null references public.rooms (id) on delete cascade,
  player_id   uuid not null,
  cell        int,
  answer      text,
  also        int[] not null default '{}',
  also_text   text[] not null default '{}',
  auto_cell   int,
  rev         int not null default 0,
  -- A vote has upheld it, so it is fixed.
  settled     boolean not null default false,
  -- Claims a vote has rejected: [{ "cell": 3, "also": [] }]
  rejected    jsonb not null default '[]',
  primary key (room_id, player_id)
);

-- Votes on the open objection. Who voted is public, how they voted isn't.
create table private.dito_votes (
  room_id  uuid not null references public.rooms (id) on delete cascade,
  voter_id uuid not null,
  accept   boolean not null,
  primary key (room_id, voter_id)
);

create table public.dito_scores (
  room_id    uuid not null references public.rooms (id) on delete cascade,
  player_id  uuid not null,
  score      int not null default 0,
  -- For ties.
  best_round int not null default 0,
  primary key (room_id, player_id)
);

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Answers are identical if they differ only in capitals, punctuation, spaces,
-- and "ß" for "ss". Keep in sync with src/games/dito/match.ts.
create function private.dito_normalize(p_text text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(
    regexp_replace(
      replace(replace(lower(normalize(p_text, nfc)), 'ß', 'ss'), 'ẞ', 'ss'),
      '(\s|[''’`´!"#$%&()*+,./:;<=>?@\[\]\\^_{|}~«»‹›„“”‚‘…–—¡¿-])+', '', 'g'),
    ''), btrim(p_text))
$$;

-- The player after p_from in the seating order.
create function private.dito_after(p_order uuid[], p_from uuid) returns uuid
language sql immutable set search_path = '' as $$
  select p_order[coalesce(array_position(p_order, p_from), 0)
                 % cardinality(p_order) + 1]
$$;

-- The saved order, without people who left and with newcomers at the end.
create function private.dito_lobby_order(p_room_id uuid) returns uuid[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(p.user_id order by
           array_position(s.order_ids, p.user_id) nulls last, p.seat_order), '{}')
  from public.players p
  left join public.dito_settings s on s.room_id = p.room_id
  where p.room_id = p_room_id
$$;

-- Deals a card and lets p_chooser pick one of its two categories.
create function private.dito_new_category(p_room_id uuid, p_chooser uuid)
returns void
language plpgsql set search_path = '' as $$
declare
  v_card private.dito_cards;
begin
  select * into v_card from private.dito_cards c
  where not exists (select 1 from private.dito_used_cards u
                    where u.room_id = p_room_id and u.card = c.category_a)
  order by random() limit 1;
  if not found then
    delete from private.dito_used_cards where room_id = p_room_id;
    select * into v_card from private.dito_cards order by random() limit 1;
  end if;
  insert into private.dito_used_cards (room_id, card)
  values (p_room_id, v_card.category_a);

  insert into public.dito_choices (room_id, chooser_id, options)
  values (p_room_id, p_chooser, array[v_card.category_a, v_card.category_b])
  on conflict (room_id) do update
  set chooser_id = excluded.chooser_id, options = excluded.options;

  update public.dito_games set
    phase = 'choosing',
    step = step + 1,
    chooser_id = p_chooser,
    submitted_ids = '{}'
  where room_id = p_room_id;
end $$;

create function private.dito_new_round(
  p_room_id uuid, p_round_no int, p_chooser uuid)
returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.dito_answers where room_id = p_room_id;
  delete from public.dito_claims where room_id = p_room_id;
  delete from private.dito_votes where room_id = p_room_id;
  update public.dito_games set
    round_no = p_round_no,
    category_no = 1,
    three_players = cardinality(order_ids) = 3,
    categories = '{}',
    reader_id = null,
    read_cell = null,
    objection = null,
    open_counts = '{}',
    last_reading = null,
    summary = null
  where room_id = p_room_id;
  perform private.dito_new_category(p_room_id, p_chooser);
end $$;

create function private.dito_count_open(p_room_id uuid) returns void
language sql set search_path = '' as $$
  update public.dito_games g set open_counts = (
    select coalesce(jsonb_object_agg(p, (
             select count(*) from public.dito_answers a
             where a.room_id = p_room_id and a.player_id = p and a.state = 'open')),
           '{}'::jsonb)
    from unnest(g.order_ids) p)
  where g.room_id = p_room_id
$$;

-- A round ends once somebody has no open answer left. Only the fullest grids
-- count, so that somebody who missed a category while offline can't end it.
create function private.dito_round_over(p_room_id uuid) returns boolean
language sql stable set search_path = '' as $$
  with grids as (
    select count(a.cell) as written,
           count(a.cell) filter (where a.state = 'open') as open
    from public.dito_games g
    cross join unnest(g.order_ids) p
    left join public.dito_answers a
      on a.room_id = g.room_id and a.player_id = p
    where g.room_id = p_room_id
    group by p
  )
  select coalesce(
    bool_or(open = 0 and written = (select max(written) from grids))
    or sum(open) = 0, true)
  from grids
$$;

-- Counts up the round and shows everybody's grid.
create function private.dito_end_round(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game    public.dito_games;
  v_player  uuid;
  v_circled int[];
  v_circles int;
  v_stars   int;
  v_bonus   int;
  v_points  int;
  v_summary jsonb := '{}';
begin
  select * into v_game from public.dito_games where room_id = p_room_id;

  foreach v_player in array v_game.order_ids loop
    select coalesce(array_agg(cell), '{}'), count(*), count(*) filter (where star)
    into v_circled, v_circles, v_stars
    from public.dito_answers
    where room_id = p_room_id and player_id = v_player and state = 'circled';

    -- Rows are worth 3, 2, 1 from the top; columns 1, 2, 3 from the left.
    select coalesce(sum(points), 0) into v_bonus
    from (values
      (array[0, 1, 2], 3), (array[3, 4, 5], 2), (array[6, 7, 8], 1),
      (array[0, 3, 6], 1), (array[1, 4, 7], 2), (array[2, 5, 8], 3)
    ) lines(cells, points)
    where cells <@ v_circled;

    v_points := v_circles
      + v_stars * (case when v_game.three_players then 1 else 2 end) + v_bonus;

    v_summary := v_summary || jsonb_build_object(v_player::text,
      jsonb_build_object(
        'circles', v_circles,
        'stars', v_stars,
        'star_points',
          v_stars * (case when v_game.three_players then 1 else 2 end),
        'bonus', v_bonus,
        'points', v_points,
        'cells', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'cell', cell, 'answer', answer, 'state', state, 'star', star)
                   order by cell), '[]'::jsonb)
          from public.dito_answers
          where room_id = p_room_id and player_id = v_player)));

    insert into public.dito_scores as s (room_id, player_id, score, best_round)
    values (p_room_id, v_player, v_points, v_points)
    on conflict (room_id, player_id) do update
    set score = s.score + excluded.score,
        best_round = greatest(s.best_round, excluded.best_round);
  end loop;

  update public.dito_games set
    phase = 'round_end',
    step = step + 1,
    reader_id = null,
    read_cell = null,
    objection = null,
    summary = v_summary
  where room_id = p_room_id;
end $$;

-- Hands the turn to the first player from p_first on, in seating order, who has
-- an open answer. p_skip is left out.
create function private.dito_next_reader(
  p_room_id uuid, p_first uuid, p_skip uuid default null)
returns void
language plpgsql set search_path = '' as $$
declare
  v_game      public.dito_games;
  v_candidate uuid := p_first;
begin
  delete from public.dito_claims where room_id = p_room_id;
  delete from private.dito_votes where room_id = p_room_id;
  perform private.dito_count_open(p_room_id);
  select * into v_game from public.dito_games where room_id = p_room_id;

  if not private.dito_round_over(p_room_id) then
    for i in 1..cardinality(v_game.order_ids) loop
      if v_candidate is distinct from p_skip
         and exists (select 1 from public.dito_answers
                     where room_id = p_room_id and player_id = v_candidate
                       and state = 'open') then
        update public.dito_games set
          phase = 'reveal',
          step = step + 1,
          reader_id = v_candidate,
          read_cell = null,
          objection = null
        where room_id = p_room_id;
        return;
      end if;
      v_candidate := private.dito_after(v_game.order_ids, v_candidate);
    end loop;
  end if;
  perform private.dito_end_round(p_room_id);
end $$;

-- Everyone has written: the next category, or the reveal.
create function private.dito_writing_done(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game  public.dito_games;
  v_first uuid;
begin
  select * into v_game from public.dito_games where room_id = p_room_id;
  if v_game.category_no < 3 then
    update public.dito_games set category_no = category_no + 1
    where room_id = p_room_id;
    perform private.dito_new_category(
      p_room_id, private.dito_after(v_game.order_ids, v_game.chooser_id));
    return;
  end if;

  -- The lowest total starts, ties are random. In round 1 everybody is tied.
  select p into v_first
  from unnest(v_game.order_ids) p
  left join public.dito_scores s on s.room_id = p_room_id and s.player_id = p
  order by coalesce(s.score, 0), random()
  limit 1;
  perform private.dito_next_reader(p_room_id, v_first);
end $$;

-- Common checks for every in-game action. p_step guards against stale or double
-- clicks.
create function private.dito_action(p_room_id uuid, p_step int, p_phase text)
returns public.dito_games
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
  v_game public.dito_games;
begin
  select * into v_game from public.dito_games where room_id = p_room_id;
  if not found or v_room.status <> 'playing'
     or v_game.step <> p_step
     or v_game.phase <> p_phase then
    raise exception 'wrong_phase';
  end if;
  if auth.uid() <> all (v_game.order_ids) then
    raise exception 'wrong_role';
  end if;
  return v_game;
end $$;

-- Marks the claims as changed: "Weiter" has to wait again.
create function private.dito_changed(p_room_id uuid) returns void
language sql set search_path = '' as $$
  update public.dito_games
  set revision = revision + 1, changed_at = clock_timestamp()
  where room_id = p_room_id
$$;

-- Decides an objection. Only a majority against rejects a claim.
create function private.dito_resolve_objection(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game   public.dito_games;
  v_target uuid;
  v_reject boolean;
begin
  select * into v_game from public.dito_games where room_id = p_room_id;
  v_target := (v_game.objection ->> 'target_id')::uuid;
  select count(*) filter (where not accept) > count(*) filter (where accept)
  into v_reject
  from private.dito_votes where room_id = p_room_id;

  if v_reject then
    -- Back to what the app had preselected.
    update public.dito_claims c set
      rejected = c.rejected
        || jsonb_build_object('cell', c.cell, 'also', to_jsonb(c.also)),
      cell = c.auto_cell,
      answer = (select a.answer from public.dito_answers a
                where a.room_id = c.room_id and a.player_id = c.player_id
                  and a.cell = c.auto_cell),
      also = '{}',
      also_text = '{}',
      rev = c.rev + 1
    where c.room_id = p_room_id and c.player_id = v_target;
  else
    update public.dito_claims set settled = true, rev = rev + 1
    where room_id = p_room_id and player_id = v_target;
  end if;

  delete from private.dito_votes where room_id = p_room_id;
  update public.dito_games set objection = null where room_id = p_room_id;
  perform private.dito_changed(p_room_id);
end $$;

-- Resolves the objection once everyone who may vote has done so.
create function private.dito_check_votes(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game public.dito_games;
begin
  select * into v_game from public.dito_games where room_id = p_room_id;
  if v_game.objection is null then
    return;
  end if;
  if not exists (
    select 1 from unnest(v_game.order_ids) p
    where p <> (v_game.objection ->> 'target_id')::uuid
      and not exists (select 1 from private.dito_votes v
                      where v.room_id = p_room_id and v.voter_id = p)) then
    perform private.dito_resolve_objection(p_room_id);
  end if;
end $$;

create function private.dito_cast_vote(p_room_id uuid, p_accept boolean)
returns void
language plpgsql set search_path = '' as $$
begin
  insert into private.dito_votes (room_id, voter_id, accept)
  values (p_room_id, auth.uid(), p_accept)
  on conflict (room_id, voter_id) do update set accept = excluded.accept;
  update public.dito_games set objection = jsonb_set(objection, '{voted_ids}', (
    select to_jsonb(coalesce(array_agg(voter_id), '{}'))
    from private.dito_votes where room_id = p_room_id))
  where room_id = p_room_id;
  perform private.dito_check_votes(p_room_id);
end $$;

-- ---------------------------------------------------------------------------
-- Lobby
-- ---------------------------------------------------------------------------

create function public.dito_lobby(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_room_id) then
    return null;
  end if;
  return jsonb_build_object(
    'order_ids', to_jsonb(private.dito_lobby_order(p_room_id)));
end $$;

create function public.dito_set_order(p_room_id uuid, p_order uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'dito' then
    raise exception 'wrong_phase';
  end if;
  -- Exactly the players in the room, each once.
  if p_order is null
     or cardinality(p_order) <> (select count(*) from public.players
                                 where room_id = p_room_id)
     or (select count(distinct p.user_id) from public.players p
         where p.room_id = p_room_id and p.user_id = any (p_order))
        <> cardinality(p_order) then
    raise exception 'players_changed';
  end if;
  insert into public.dito_settings (room_id, order_ids)
  values (p_room_id, p_order)
  on conflict (room_id) do update set order_ids = excluded.order_ids;
  perform private.touch(p_room_id);
end $$;

-- ---------------------------------------------------------------------------
-- Game functions (callable by clients)
-- ---------------------------------------------------------------------------

create function public.dito_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms := private.lock_room(p_room_id);
  v_order uuid[];
  v_first uuid;
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'dito' then
    raise exception 'wrong_phase';
  end if;
  v_order := private.dito_lobby_order(p_room_id);
  if cardinality(v_order) < 3 then
    raise exception 'not_enough_players';
  end if;
  v_first := v_order[1 + floor(random() * cardinality(v_order))::int];

  delete from public.dito_games  where room_id = p_room_id;
  delete from public.dito_scores where room_id = p_room_id;

  insert into public.dito_games (room_id, phase, order_ids, chooser_id)
  values (p_room_id, 'choosing', v_order, v_first);
  perform private.dito_new_round(p_room_id, 1, v_first);

  update public.rooms set status = 'playing', open_to_join = false
  where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

create function public.dito_choose(p_room_id uuid, p_step int, p_category text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.dito_games := private.dito_action(p_room_id, p_step, 'choosing');
begin
  if v_game.chooser_id <> auth.uid() then
    raise exception 'wrong_role';
  end if;
  if not exists (select 1 from public.dito_choices
                 where room_id = p_room_id and p_category = any (options)) then
    raise exception 'invalid_action';
  end if;
  update public.dito_games set
    phase = 'writing',
    step = step + 1,
    categories = array_append(categories, p_category)
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Three answers and the cells they go in. Can be sent again until everyone has.
create function public.dito_submit(
  p_room_id uuid, p_step int, p_cells int[], p_answers text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game    public.dito_games := private.dito_action(p_room_id, p_step, 'writing');
  v_answers text[];
  v_norms   text[];
begin
  if cardinality(p_cells) is distinct from 3
     or cardinality(p_answers) is distinct from 3 then
    raise exception 'invalid_action';
  end if;
  select array_agg(btrim(regexp_replace(coalesce(a, ''), '\s+', ' ', 'g'))
                   order by i)
  into v_answers
  from unnest(p_answers) with ordinality u(a, i);
  if exists (select 1 from unnest(v_answers) a
             where char_length(a) not between 1 and 60) then
    raise exception 'dito_invalid_answer';
  end if;

  delete from public.dito_answers
  where room_id = p_room_id and player_id = auth.uid()
    and category_no = v_game.category_no;

  if (select count(distinct c) from unnest(p_cells) c
      where c between 0 and 8) <> 3
     or exists (select 1 from public.dito_answers
                where room_id = p_room_id and player_id = auth.uid()
                  and cell = any (p_cells)) then
    raise exception 'invalid_action';
  end if;

  -- No answer twice in a round, as far as the app can tell.
  select array_agg(private.dito_normalize(a)) into v_norms
  from unnest(v_answers) a;
  if (select count(distinct n) from unnest(v_norms) n) <> 3
     or exists (select 1 from public.dito_answers
                where room_id = p_room_id and player_id = auth.uid()
                  and norm = any (v_norms)) then
    raise exception 'repeated_answer';
  end if;

  insert into public.dito_answers
    (room_id, player_id, cell, category_no, answer, norm)
  select p_room_id, auth.uid(), p_cells[i], v_game.category_no,
         v_answers[i], v_norms[i]
  from generate_series(1, 3) i;

  update public.dito_games
  set submitted_ids = array_append(
        array_remove(submitted_ids, auth.uid()), auth.uid())
  where room_id = p_room_id;

  select * into v_game from public.dito_games where room_id = p_room_id;
  if v_game.order_ids <@ v_game.submitted_ids then
    perform private.dito_writing_done(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- The reader picks one of their open answers. Whoever has an identical one gets
-- it preselected.
create function public.dito_read(p_room_id uuid, p_step int, p_cell int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.dito_games := private.dito_action(p_room_id, p_step, 'reveal');
  v_read public.dito_answers;
begin
  if v_game.reader_id <> auth.uid() or v_game.read_cell is not null then
    raise exception 'wrong_phase';
  end if;
  select * into v_read from public.dito_answers
  where room_id = p_room_id and player_id = auth.uid() and cell = p_cell
    and state = 'open';
  if not found then
    raise exception 'invalid_action';
  end if;

  insert into public.dito_claims (room_id, player_id, cell, answer, auto_cell)
  select p_room_id, p, a.cell, a.answer, a.cell
  from unnest(v_game.order_ids) p
  left join lateral (
    select x.cell, x.answer from public.dito_answers x
    where x.room_id = p_room_id and x.player_id = p and x.state = 'open'
      and case when p = auth.uid() then x.cell = p_cell
               else x.norm = v_read.norm end
    order by x.cell limit 1
  ) a on true;

  update public.dito_games
  set read_cell = p_cell, step = step + 1, last_reading = null
  where room_id = p_room_id;
  perform private.dito_changed(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- What the caller circles for the answer being read (null: nothing), and which
-- other answers of theirs mean the same and get crossed out. The reader can only
-- add the latter.
create function public.dito_claim(
  p_room_id uuid, p_step int, p_cell int, p_also int[] default '{}')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game  public.dito_games := private.dito_action(p_room_id, p_step, 'reveal');
  v_claim public.dito_claims;
  v_cell  int := p_cell;
  v_also  int[];
begin
  if v_game.read_cell is null then
    raise exception 'wrong_phase';
  end if;
  if v_game.objection is not null then
    raise exception 'objection_open';
  end if;
  select * into v_claim from public.dito_claims
  where room_id = p_room_id and player_id = auth.uid();

  if v_game.reader_id = auth.uid() then
    v_cell := v_claim.auto_cell;
  end if;
  select coalesce(array_agg(distinct c order by c), '{}') into v_also
  from unnest(coalesce(p_also, '{}')) c
  where c is distinct from v_cell;
  -- Choosing another answer than the identical one: that one means the same too.
  if v_cell is not null and v_claim.auto_cell is not null
     and v_cell <> v_claim.auto_cell and v_claim.auto_cell <> all (v_also) then
    select array_agg(c order by c) into v_also
    from unnest(array_append(v_also, v_claim.auto_cell)) c;
  end if;
  if v_cell is null and cardinality(v_also) > 0 then
    raise exception 'invalid_action';
  end if;

  if v_cell is not distinct from v_claim.cell and v_also = v_claim.also then
    return;
  end if;
  if v_claim.settled then
    raise exception 'claim_settled';
  end if;
  -- Compared one by one: "@>" would also match a longer "also" list.
  if exists (
    select 1 from jsonb_array_elements(v_claim.rejected) r
    where r = jsonb_build_object('cell', v_cell, 'also', to_jsonb(v_also))) then
    raise exception 'claim_rejected';
  end if;
  if exists (
    select 1 from unnest(array_append(v_also, v_cell)) c
    where c is not null and not exists (
      select 1 from public.dito_answers a
      where a.room_id = p_room_id and a.player_id = auth.uid()
        and a.cell = c and a.state = 'open')) then
    raise exception 'invalid_action';
  end if;

  update public.dito_claims set
    cell = v_cell,
    answer = (select a.answer from public.dito_answers a
              where a.room_id = p_room_id and a.player_id = auth.uid()
                and a.cell = v_cell),
    also = v_also,
    also_text = array(
      select a.answer from public.dito_answers a
      where a.room_id = p_room_id and a.player_id = auth.uid()
        and a.cell = any (v_also) order by a.cell),
    rev = rev + 1
  where room_id = p_room_id and player_id = auth.uid();
  perform private.dito_changed(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- "Einspruch" against what another player changed. p_rev is the version of the
-- claim the caller sees. The objection counts as the caller's vote against.
create function public.dito_object(
  p_room_id uuid, p_step int, p_target uuid, p_rev int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game  public.dito_games := private.dito_action(p_room_id, p_step, 'reveal');
  v_claim public.dito_claims;
begin
  if v_game.read_cell is null then
    raise exception 'wrong_phase';
  end if;
  if v_game.objection is not null then
    raise exception 'objection_open';
  end if;
  select * into v_claim from public.dito_claims
  where room_id = p_room_id and player_id = p_target;
  if not found or p_target = auth.uid() then
    raise exception 'invalid_action';
  end if;
  if v_claim.rev <> p_rev then
    raise exception 'claims_changed';
  end if;
  if v_claim.settled then
    raise exception 'claim_settled';
  end if;
  -- Only the players' own changes, never what the app preselected.
  if v_claim.cell is not distinct from v_claim.auto_cell
     and cardinality(v_claim.also) = 0 then
    raise exception 'invalid_action';
  end if;

  delete from private.dito_votes where room_id = p_room_id;
  update public.dito_games set
    objections = objections + 1,
    objection = jsonb_build_object(
      'no', objections + 1, 'target_id', p_target, 'by_id', auth.uid(),
      'voted_ids', '[]'::jsonb, 'opened_at', clock_timestamp())
  where room_id = p_room_id;
  perform private.dito_cast_vote(p_room_id, false);
  perform private.touch(p_room_id);
end $$;

create function public.dito_vote(
  p_room_id uuid, p_step int, p_objection int, p_accept boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.dito_games := private.dito_action(p_room_id, p_step, 'reveal');
begin
  if (v_game.objection ->> 'no')::int is distinct from p_objection
     or p_accept is null then
    raise exception 'wrong_phase';
  end if;
  if (v_game.objection ->> 'target_id')::uuid = auth.uid() then
    raise exception 'wrong_role';
  end if;
  perform private.dito_cast_vote(p_room_id, p_accept);
  perform private.touch(p_room_id);
end $$;

-- Host tool, if somebody doesn't respond: decides with the votes that are in.
create function public.dito_close_vote(
  p_room_id uuid, p_step int, p_objection int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.dito_games := private.dito_action(p_room_id, p_step, 'reveal');
begin
  perform private.require_host(p_room_id);
  if (v_game.objection ->> 'no')::int is distinct from p_objection then
    raise exception 'wrong_phase';
  end if;
  if (v_game.objection ->> 'opened_at')::timestamptz
     > clock_timestamp() - interval '15 seconds' then
    raise exception 'too_early';
  end if;
  perform private.dito_resolve_objection(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- "Weiter": accepts the claims the caller sees and passes the turn on. Only 5
-- seconds after the last change, so the others can react. The host may step in
-- if the reader is offline.
create function public.dito_confirm(
  p_room_id uuid, p_step int, p_revision int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game   public.dito_games := private.dito_action(p_room_id, p_step, 'reveal');
  v_others int;
  v_read   text;
  v_last   jsonb;
begin
  if v_game.read_cell is null then
    raise exception 'wrong_phase';
  end if;
  if v_game.reader_id <> auth.uid() then
    perform private.require_host(p_room_id);
    if not private.is_stale(p_room_id, v_game.reader_id) then
      raise exception 'players_still_here';
    end if;
  end if;
  if v_game.objection is not null then
    raise exception 'objection_open';
  end if;
  if v_game.revision <> p_revision then
    raise exception 'claims_changed';
  end if;
  if v_game.changed_at > clock_timestamp() - interval '5 seconds' then
    raise exception 'too_early';
  end if;

  select count(*) into v_others from public.dito_claims
  where room_id = p_room_id and player_id <> v_game.reader_id
    and cell is not null;
  select answer into v_read from public.dito_answers
  where room_id = p_room_id and player_id = v_game.reader_id
    and cell = v_game.read_cell;
  v_last := jsonb_build_object(
    'reader_id', v_game.reader_id,
    'answer', v_read,
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'player_id', player_id, 'answer', answer)), '[]'::jsonb)
      from public.dito_claims
      where room_id = p_room_id and player_id <> v_game.reader_id
        and cell is not null));

  update public.dito_answers a set
    state = case when v_others > 0 then 'circled' else 'crossed' end,
    -- Exactly two with the same answer: a star for both.
    star = v_others = 1
  from public.dito_claims c
  where c.room_id = p_room_id and a.room_id = p_room_id
    and a.player_id = c.player_id and a.cell = c.cell;

  update public.dito_answers a set state = 'crossed'
  from public.dito_claims c
  where c.room_id = p_room_id and a.room_id = p_room_id
    and a.player_id = c.player_id and a.cell = any (c.also);

  update public.dito_games set last_reading = v_last where room_id = p_room_id;
  perform private.dito_next_reader(
    p_room_id, private.dito_after(v_game.order_ids, v_game.reader_id));
  perform private.touch(p_room_id);
end $$;

create function public.dito_next_round(p_room_id uuid, p_step int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.dito_games := private.dito_action(p_room_id, p_step, 'round_end');
begin
  perform private.require_host(p_room_id);
  if v_game.round_no >= 3 then
    update public.dito_games set phase = 'game_over', step = step + 1
    where room_id = p_room_id;
    update public.rooms set status = 'finished' where id = p_room_id;
  else
    perform private.dito_new_round(
      p_room_id, v_game.round_no + 1,
      private.dito_after(v_game.order_ids, v_game.chooser_id));
  end if;
  perform private.touch(p_room_id);
end $$;

-- Host tool: pass over somebody who is offline, either as the one picking a
-- category or as the one about to read.
create function public.dito_skip(p_room_id uuid, p_step int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room   public.rooms := private.lock_room(p_room_id);
  v_game   public.dito_games;
  v_absent uuid;
begin
  perform private.require_host(p_room_id);
  select * into v_game from public.dito_games where room_id = p_room_id;
  if not found or v_room.status <> 'playing' or v_game.step <> p_step
     or not (v_game.phase = 'choosing'
             or (v_game.phase = 'reveal' and v_game.read_cell is null)) then
    raise exception 'wrong_phase';
  end if;
  v_absent := case v_game.phase
    when 'choosing' then v_game.chooser_id else v_game.reader_id end;
  if v_absent = auth.uid() or not private.is_stale(p_room_id, v_absent) then
    raise exception 'players_still_here';
  end if;

  if v_game.phase = 'choosing' then
    perform private.dito_new_category(
      p_room_id, private.dito_after(v_game.order_ids, v_absent));
  else
    update public.dito_games set last_reading = null where room_id = p_room_id;
    -- If nobody else has an open answer, the round ends.
    perform private.dito_next_reader(
      p_room_id, private.dito_after(v_game.order_ids, v_absent), v_absent);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Host tool: go on without people who are offline. Their cells stay empty.
create function public.dito_force_continue(p_room_id uuid, p_step int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.dito_games := private.dito_action(p_room_id, p_step, 'writing');
begin
  perform private.require_host(p_room_id);
  if exists (select 1 from unnest(v_game.order_ids) p
             where p <> all (v_game.submitted_ids)
               and (p = auth.uid() or not private.is_stale(p_room_id, p))) then
    raise exception 'players_still_here';
  end if;
  if cardinality(v_game.submitted_ids) = 0 then
    raise exception 'answers_missing';
  end if;
  perform private.dito_writing_done(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- Keeps a running game consistent when a player leaves or is kicked.
create function private.dito_player_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_game  public.dito_games;
  v_next  uuid;
  v_order uuid[];
begin
  if not exists (select 1 from public.rooms
                 where id = old.room_id and status = 'playing') then
    return null;
  end if;
  select * into v_game from public.dito_games where room_id = old.room_id;
  if not found or old.user_id <> all (v_game.order_ids) then
    return null;
  end if;

  v_next := private.dito_after(v_game.order_ids, old.user_id);
  v_order := array_remove(v_game.order_ids, old.user_id);

  delete from public.dito_answers
  where room_id = old.room_id and player_id = old.user_id;
  delete from public.dito_claims
  where room_id = old.room_id and player_id = old.user_id;
  delete from private.dito_votes
  where room_id = old.room_id and voter_id = old.user_id;

  update public.dito_games set
    order_ids = v_order,
    submitted_ids = array_remove(submitted_ids, old.user_id),
    open_counts = open_counts - old.user_id::text,
    summary = summary - old.user_id::text
  where room_id = old.room_id;

  if cardinality(v_order) < 3 then
    update public.dito_games
    set phase = 'game_over', step = step + 1, reader_id = null,
        read_cell = null, objection = null
    where room_id = old.room_id;
    update public.rooms set status = 'finished' where id = old.room_id;
    return null;
  end if;

  if v_game.phase = 'choosing' then
    if v_game.chooser_id = old.user_id then
      perform private.dito_new_category(old.room_id, v_next);
    end if;
  elsif v_game.phase in ('writing', 'round_end') then
    -- The next pick is passed on from the chooser, so keep it in the order.
    if v_game.chooser_id = old.user_id then
      update public.dito_games set chooser_id = (
        select p from unnest(v_order) p
        where private.dito_after(v_order, p) = v_next limit 1)
      where room_id = old.room_id;
    end if;
    if v_game.phase = 'writing' and exists (
         select 1 from public.dito_games
         where room_id = old.room_id and order_ids <@ submitted_ids) then
      perform private.dito_writing_done(old.room_id);
    end if;
  elsif v_game.phase = 'reveal' then
    if v_game.reader_id = old.user_id then
      update public.dito_games set last_reading = null
      where room_id = old.room_id;
      perform private.dito_next_reader(old.room_id, v_next);
    elsif v_game.read_cell is null then
      -- Their leaving may have ended the round.
      perform private.dito_next_reader(old.room_id, v_game.reader_id);
    else
      perform private.dito_count_open(old.room_id);
      if (v_game.objection ->> 'target_id')::uuid = old.user_id then
        delete from private.dito_votes where room_id = old.room_id;
        update public.dito_games set objection = null
        where room_id = old.room_id;
      else
        perform private.dito_check_votes(old.room_id);
      end if;
      perform private.dito_changed(old.room_id);
    end if;
  end if;
  return null;
end $$;

create trigger dito_player_removed
after delete on public.players
for each row execute function private.dito_player_removed();

-- One consistent view of the game. Runs with the caller's rights, so RLS decides
-- what is in it: only your own grid until the round is over.
create function public.dito_snapshot(p_room_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'game', to_jsonb(g),
    'options', (
      select to_jsonb(c.options) from public.dito_choices c
      where c.room_id = g.room_id and g.phase = 'choosing'),
    'own', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'cell', a.cell, 'category_no', a.category_no, 'answer', a.answer,
               'state', a.state, 'star', a.star)
               order by a.cell), '[]'::jsonb)
      from public.dito_answers a
      where a.room_id = g.room_id and a.player_id = (select auth.uid())),
    'claims', (
      select coalesce(jsonb_agg(to_jsonb(c) - 'room_id' order by c.player_id),
                      '[]'::jsonb)
      from public.dito_claims c where c.room_id = g.room_id),
    'scores', (
      select coalesce(jsonb_object_agg(s.player_id, jsonb_build_object(
               'score', s.score, 'best_round', s.best_round)), '{}'::jsonb)
      from public.dito_scores s where s.room_id = g.room_id)
  )
  from public.dito_games g
  where g.room_id = p_room_id
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table private.dito_cards      enable row level security;
alter table private.dito_used_cards enable row level security;
alter table private.dito_votes      enable row level security;
alter table public.dito_settings    enable row level security;
alter table public.dito_games       enable row level security;
alter table public.dito_choices     enable row level security;
alter table public.dito_answers     enable row level security;
alter table public.dito_claims      enable row level security;
alter table public.dito_scores      enable row level security;

revoke all on
  public.dito_settings, public.dito_games, public.dito_choices,
  public.dito_answers, public.dito_claims, public.dito_scores
from anon, authenticated;
grant select on
  public.dito_settings, public.dito_games, public.dito_choices,
  public.dito_answers, public.dito_claims, public.dito_scores
to authenticated;

create policy "members can read the settings" on public.dito_settings
  for select to authenticated using (private.is_member(room_id));
create policy "members can read the game" on public.dito_games
  for select to authenticated using (private.is_member(room_id));
create policy "members can read the claims" on public.dito_claims
  for select to authenticated using (private.is_member(room_id));
create policy "members can read scores" on public.dito_scores
  for select to authenticated using (private.is_member(room_id));
create policy "only the chooser sees the card" on public.dito_choices
  for select to authenticated using (
    private.is_member(room_id) and chooser_id = (select auth.uid()));
create policy "players can read only their own grid" on public.dito_answers
  for select to authenticated using (
    private.is_member(room_id) and player_id = (select auth.uid()));

revoke execute on function
  public.dito_lobby(uuid),
  public.dito_set_order(uuid, uuid[]),
  public.dito_start(uuid),
  public.dito_choose(uuid, int, text),
  public.dito_submit(uuid, int, int[], text[]),
  public.dito_read(uuid, int, int),
  public.dito_claim(uuid, int, int, int[]),
  public.dito_object(uuid, int, uuid, int),
  public.dito_vote(uuid, int, int, boolean),
  public.dito_close_vote(uuid, int, int),
  public.dito_confirm(uuid, int, int),
  public.dito_next_round(uuid, int),
  public.dito_skip(uuid, int),
  public.dito_force_continue(uuid, int),
  public.dito_snapshot(uuid)
from public, anon;

grant execute on function
  public.dito_lobby(uuid),
  public.dito_set_order(uuid, uuid[]),
  public.dito_start(uuid),
  public.dito_choose(uuid, int, text),
  public.dito_submit(uuid, int, int[], text[]),
  public.dito_read(uuid, int, int),
  public.dito_claim(uuid, int, int, int[]),
  public.dito_object(uuid, int, uuid, int),
  public.dito_vote(uuid, int, int, boolean),
  public.dito_close_vote(uuid, int, int),
  public.dito_confirm(uuid, int, int),
  public.dito_next_round(uuid, int),
  public.dito_skip(uuid, int),
  public.dito_force_continue(uuid, int),
  public.dito_snapshot(uuid)
to authenticated;

-- See 20261128000100_lock_down_private.sql.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid) to authenticated;
