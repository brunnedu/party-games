-- Just One.

insert into public.game_types (id, min_players, max_players)
values ('just-one', 3, 10);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.just_one_games (
  room_id       uuid primary key references public.rooms (id) on delete cascade,
  phase         text not null check (phase in (
                  'choosing_word', 'writing_clues', 'reviewing_clues',
                  'guessing', 'round_result', 'game_over')),
  round_no      int  not null,
  guesser_id    uuid not null,
  guesser_seat  int  not null,
  cards_total   int  not null default 13,
  cards_used    int  not null default 0,
  score         int  not null default 0,
  submitted_ids uuid[] not null default '{}',
  confirmed_ids uuid[] not null default '{}'
);

-- Word pool and shuffled decks live in "private": no client can ever read them.
create table private.just_one_words (
  word text primary key
);

create table private.just_one_decks (
  room_id  uuid primary key references public.rooms (id) on delete cascade,
  words    text[] not null,
  next_idx int not null default 1
);

create table public.just_one_secrets (
  room_id  uuid not null references public.rooms (id) on delete cascade,
  round_no int  not null,
  word     text not null,
  primary key (room_id, round_no)
);

create table public.just_one_clues (
  room_id          uuid not null references public.rooms (id) on delete cascade,
  round_no         int  not null,
  player_id        uuid not null,
  clue             text not null,
  normalized       text not null,
  auto_cancelled   boolean not null default false,
  manual_cancelled boolean not null default false,
  primary key (room_id, round_no, player_id)
);

create table public.just_one_guesses (
  room_id  uuid not null references public.rooms (id) on delete cascade,
  round_no int  not null,
  guess    text,
  result   text not null check (result in ('correct', 'wrong', 'pass')),
  primary key (room_id, round_no)
);

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Used to compare clues and guesses. Only the database compares words.
create function private.normalize_word(p_text text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(
           btrim(regexp_replace(lower(normalize(p_text, nfc)), '\s+', ' ', 'g')),
           'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
$$;

create function private.just_one_draw(p_room_id uuid) returns text
language plpgsql set search_path = '' as $$
declare
  v_deck private.just_one_decks;
begin
  select * into v_deck from private.just_one_decks
  where room_id = p_room_id for update;

  -- Only reachable by skipping hundreds of words: start over.
  if v_deck.next_idx > cardinality(v_deck.words) then
    v_deck.next_idx := 1;
  end if;

  update private.just_one_decks set next_idx = v_deck.next_idx + 1
  where room_id = p_room_id;
  return v_deck.words[v_deck.next_idx];
end $$;

-- Starts the next round with the next player (by seat) as guesser.
create function private.just_one_new_round(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game public.just_one_games;
  v_next public.players;
begin
  select * into v_game from public.just_one_games where room_id = p_room_id;

  select * into v_next from public.players
  where room_id = p_room_id
  order by (seat_order <= v_game.guesser_seat), seat_order
  limit 1;

  update public.just_one_games set
    phase = 'choosing_word',
    round_no = v_game.round_no + 1,
    guesser_id = v_next.user_id,
    guesser_seat = v_next.seat_order,
    submitted_ids = '{}',
    confirmed_ids = '{}'
  where room_id = p_room_id;

  insert into public.just_one_secrets (room_id, round_no, word)
  values (p_room_id, v_game.round_no + 1, private.just_one_draw(p_room_id));
end $$;

-- writing_clues -> reviewing_clues, cancelling duplicates.
create function private.just_one_start_review(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game public.just_one_games;
  v_word text;
begin
  select * into v_game from public.just_one_games where room_id = p_room_id;
  select private.normalize_word(word) into v_word
  from public.just_one_secrets
  where room_id = p_room_id and round_no = v_game.round_no;

  -- Identical clues cancel each other; the mystery word itself is invalid.
  update public.just_one_clues c set auto_cancelled =
    c.normalized = v_word
    or exists (
      select 1 from public.just_one_clues o
      where o.room_id = c.room_id and o.round_no = c.round_no
        and o.player_id <> c.player_id and o.normalized = c.normalized)
  where c.room_id = p_room_id and c.round_no = v_game.round_no;

  update public.just_one_games
  set phase = 'reviewing_clues', confirmed_ids = '{}'
  where room_id = p_room_id;
end $$;

create function private.just_one_all_submitted(p_room_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.players p
    join public.just_one_games g on g.room_id = p.room_id
    where p.room_id = p_room_id
      and p.user_id <> g.guesser_id
      and p.user_id <> all (g.submitted_ids))
$$;

-- Common checks for every in-game action. p_round_no guards against stale or
-- double clicks. p_role is 'guesser', 'clue_giver' or 'any'.
create function private.just_one_action(
  p_room_id uuid, p_round_no int, p_phases text[], p_role text)
returns public.just_one_games
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
  v_game public.just_one_games;
begin
  select * into v_game from public.just_one_games where room_id = p_room_id;
  if not found or v_room.status <> 'playing'
     or v_game.round_no <> p_round_no
     or v_game.phase <> all (p_phases) then
    raise exception 'wrong_phase';
  end if;
  if (p_role = 'guesser' and v_game.guesser_id <> auth.uid())
     or (p_role = 'clue_giver' and v_game.guesser_id = auth.uid()) then
    raise exception 'wrong_role';
  end if;
  return v_game;
end $$;

-- ---------------------------------------------------------------------------
-- Game functions (callable by clients)
-- ---------------------------------------------------------------------------

create function public.just_one_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room    public.rooms := private.lock_room(p_room_id);
  v_count   int;
  v_guesser public.players;
begin
  if v_room.host_id <> auth.uid() then
    raise exception 'not_host';
  end if;
  if v_room.status <> 'lobby' or v_room.game_type <> 'just-one' then
    raise exception 'wrong_phase';
  end if;
  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < 3 then
    raise exception 'not_enough_players';
  end if;

  delete from public.just_one_games   where room_id = p_room_id;
  delete from public.just_one_secrets where room_id = p_room_id;
  delete from public.just_one_clues   where room_id = p_room_id;
  delete from public.just_one_guesses where room_id = p_room_id;
  delete from private.just_one_decks  where room_id = p_room_id;

  insert into private.just_one_decks (room_id, words)
  select p_room_id, array_agg(word order by random())
  from private.just_one_words;

  select * into v_guesser from public.players
  where room_id = p_room_id order by random() limit 1;

  insert into public.just_one_games
    (room_id, phase, round_no, guesser_id, guesser_seat)
  values
    (p_room_id, 'choosing_word', 1, v_guesser.user_id, v_guesser.seat_order);

  insert into public.just_one_secrets (room_id, round_no, word)
  values (p_room_id, 1, private.just_one_draw(p_room_id));

  update public.rooms set status = 'playing' where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

create function public.just_one_accept_word(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.just_one_action(
    p_room_id, p_round_no, array['choosing_word'], 'clue_giver');
  update public.just_one_games set phase = 'writing_clues'
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- p_word is the word being skipped, so that two players pressing "skip" at the
-- same time only skip once. Skipping does not use up a card.
create function public.just_one_skip_word(
  p_room_id uuid, p_round_no int, p_word text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.just_one_action(
    p_room_id, p_round_no, array['choosing_word'], 'clue_giver');
  if exists (select 1 from public.just_one_secrets
             where room_id = p_room_id and round_no = p_round_no
               and word = p_word) then
    update public.just_one_secrets
    set word = private.just_one_draw(p_room_id)
    where room_id = p_room_id and round_no = p_round_no;
    perform private.touch(p_room_id);
  end if;
end $$;

create function public.just_one_submit_clue(
  p_room_id uuid, p_round_no int, p_clue text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clue text := btrim(regexp_replace(coalesce(p_clue, ''), '\s+', ' ', 'g'));
begin
  perform private.just_one_action(
    p_room_id, p_round_no, array['writing_clues'], 'clue_giver');
  if char_length(v_clue) < 1 or char_length(v_clue) > 30 then
    raise exception 'invalid_clue';
  end if;

  insert into public.just_one_clues
    (room_id, round_no, player_id, clue, normalized)
  values
    (p_room_id, p_round_no, auth.uid(), v_clue,
     private.normalize_word(v_clue))
  on conflict (room_id, round_no, player_id)
  do update set clue = excluded.clue, normalized = excluded.normalized;

  update public.just_one_games
  set submitted_ids = array_append(
        array_remove(submitted_ids, auth.uid()), auth.uid())
  where room_id = p_room_id;

  if private.just_one_all_submitted(p_room_id) then
    perform private.just_one_start_review(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

create function public.just_one_toggle_clue(
  p_room_id uuid, p_round_no int, p_player_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.just_one_action(
    p_room_id, p_round_no, array['reviewing_clues'], 'clue_giver');

  update public.just_one_clues
  set manual_cancelled = not manual_cancelled
  where room_id = p_room_id and round_no = p_round_no
    and player_id = p_player_id and not auto_cancelled;

  if found then
    -- Confirmations only count for the selection people actually saw.
    update public.just_one_games set confirmed_ids = '{}'
    where room_id = p_room_id;
    perform private.touch(p_room_id);
  end if;
end $$;

-- The host (if giving clues) or a majority of clue-givers ends the review.
create function public.just_one_confirm_review(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_confirmed int;
  v_givers    int;
  v_is_host   boolean;
begin
  perform private.just_one_action(
    p_room_id, p_round_no, array['reviewing_clues'], 'clue_giver');

  update public.just_one_games
  set confirmed_ids = array_append(
        array_remove(confirmed_ids, auth.uid()), auth.uid())
  where room_id = p_room_id
  returning cardinality(confirmed_ids) into v_confirmed;

  select count(*) - 1 into v_givers
  from public.players where room_id = p_room_id;
  select host_id = auth.uid() into v_is_host
  from public.rooms where id = p_room_id;

  if v_is_host or v_confirmed * 2 > v_givers then
    update public.just_one_games set phase = 'guessing'
    where room_id = p_room_id;
  end if;
  perform private.touch(p_room_id);
end $$;

-- A null guess means "pass".
create function public.just_one_submit_guess(
  p_room_id uuid, p_round_no int, p_guess text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_guess  text := btrim(regexp_replace(p_guess, '\s+', ' ', 'g'));
  v_word   text;
  v_result text;
begin
  perform private.just_one_action(
    p_room_id, p_round_no, array['guessing'], 'guesser');
  if v_guess is not null
     and (char_length(v_guess) < 1 or char_length(v_guess) > 40) then
    raise exception 'invalid_guess';
  end if;

  select word into v_word from public.just_one_secrets
  where room_id = p_room_id and round_no = p_round_no;

  v_result := case
    when v_guess is null then 'pass'
    when private.normalize_word(v_guess) = private.normalize_word(v_word)
      then 'correct'
    else 'wrong'
  end;

  insert into public.just_one_guesses (room_id, round_no, guess, result)
  values (p_room_id, p_round_no, v_guess, v_result);

  update public.just_one_games
  set phase = 'round_result',
      score = score + (v_result = 'correct')::int
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- "Accept anyway", e.g. for typos.
create function public.just_one_accept_guess(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.just_one_action(
    p_room_id, p_round_no, array['round_result'], 'clue_giver');

  update public.just_one_guesses set result = 'correct'
  where room_id = p_room_id and round_no = p_round_no and result = 'wrong';

  if found then
    update public.just_one_games set score = score + 1
    where room_id = p_room_id;
    perform private.touch(p_room_id);
  end if;
end $$;

-- Applies the card cost of the finished round. The penalty for a wrong guess is
-- only applied here, so that "accept anyway" can still happen before.
create function public.just_one_next_round(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game   public.just_one_games := private.just_one_action(
             p_room_id, p_round_no, array['round_result'], 'any');
  v_result text;
  v_used   int;
  v_score  int;
begin
  -- The guesser can't cut off "accept anyway", unless they are the host.
  if v_game.guesser_id = auth.uid() and not exists (
       select 1 from public.rooms
       where id = p_room_id and host_id = auth.uid()) then
    raise exception 'wrong_role';
  end if;

  select result into v_result from public.just_one_guesses
  where room_id = p_room_id and round_no = p_round_no;

  v_used := v_game.cards_used + 1;
  v_score := v_game.score;
  if v_result = 'wrong' then
    if v_used < v_game.cards_total then
      v_used := v_used + 1;                 -- lose the next card too
    else
      v_score := greatest(v_score - 1, 0);  -- no card left: lose a point
    end if;
  end if;

  update public.just_one_games set cards_used = v_used, score = v_score
  where room_id = p_room_id;

  if v_used >= v_game.cards_total then
    update public.just_one_games set phase = 'game_over'
    where room_id = p_room_id;
    update public.rooms set status = 'finished' where id = p_room_id;
  else
    perform private.just_one_new_round(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Host tools for when somebody is missing. A host who is also the guesser may
-- only force the clue phases once the people being waited for are offline.
create function public.just_one_force_continue(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.just_one_games := private.just_one_action(
    p_room_id, p_round_no, array['writing_clues', 'reviewing_clues'], 'any');
begin
  if not exists (select 1 from public.rooms
                 where id = p_room_id and host_id = auth.uid()) then
    raise exception 'not_host';
  end if;

  if v_game.guesser_id = auth.uid() and exists (
       select 1 from public.players p
       where p.room_id = p_room_id
         and p.user_id <> v_game.guesser_id
         and p.user_id <> all (case v_game.phase
               when 'writing_clues' then v_game.submitted_ids
               else v_game.confirmed_ids end)
         and not private.is_stale(p_room_id, p.user_id)) then
    raise exception 'players_still_here';
  end if;

  if v_game.phase = 'writing_clues' then
    if cardinality(v_game.submitted_ids) = 0 then
      raise exception 'no_clues_yet';
    end if;
    perform private.just_one_start_review(p_room_id);
  else
    update public.just_one_games set phase = 'guessing'
    where room_id = p_room_id;
  end if;
  perform private.touch(p_room_id);
end $$;

-- Discards the current card, like a pass.
create function public.just_one_skip_round(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.just_one_action(
    p_room_id, p_round_no,
    array['choosing_word', 'writing_clues', 'reviewing_clues', 'guessing'],
    'any');
  if not exists (select 1 from public.rooms
                 where id = p_room_id and host_id = auth.uid()) then
    raise exception 'not_host';
  end if;

  insert into public.just_one_guesses (room_id, round_no, guess, result)
  values (p_room_id, p_round_no, null, 'pass');
  update public.just_one_games set phase = 'round_result'
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Keeps a running game consistent when a player leaves or is kicked.
create function private.just_one_player_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.just_one_games;
begin
  if not exists (select 1 from public.rooms
                 where id = old.room_id and status = 'playing') then
    return null;
  end if;
  select * into v_game from public.just_one_games where room_id = old.room_id;
  if not found then
    return null;
  end if;

  if (select count(*) from public.players where room_id = old.room_id) < 3 then
    update public.just_one_games set phase = 'game_over'
    where room_id = old.room_id;
    update public.rooms set status = 'finished' where id = old.room_id;
    return null;
  end if;

  if v_game.phase = 'round_result' then
    return null;
  end if;

  if v_game.guesser_id = old.user_id then
    -- The round is replayed with the next guesser, without using up a card.
    perform private.just_one_new_round(old.room_id);
    return null;
  end if;

  delete from public.just_one_clues
  where room_id = old.room_id and round_no = v_game.round_no
    and player_id = old.user_id and v_game.phase = 'writing_clues';

  update public.just_one_games set
    submitted_ids = array_remove(submitted_ids, old.user_id),
    confirmed_ids = array_remove(confirmed_ids, old.user_id)
  where room_id = old.room_id;

  if v_game.phase = 'writing_clues'
     and private.just_one_all_submitted(old.room_id) then
    perform private.just_one_start_review(old.room_id);
  end if;
  return null;
end $$;

create trigger just_one_player_removed
after delete on public.players
for each row execute function private.just_one_player_removed();

-- One consistent view of the game. Runs with the caller's rights, so RLS
-- decides what is in it: the guesser gets no word and no clues too early.
create function public.just_one_snapshot(p_room_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'game', to_jsonb(g),
    'word', (select s.word from public.just_one_secrets s
             where s.room_id = g.room_id and s.round_no = g.round_no),
    'clues', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.normalized, c.player_id),
                      '[]'::jsonb)
      from public.just_one_clues c
      where c.room_id = g.room_id and c.round_no = g.round_no),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'round_no', q.round_no, 'guess', q.guess, 'result', q.result,
               'word', s.word) order by q.round_no), '[]'::jsonb)
      from public.just_one_guesses q
      left join public.just_one_secrets s
        on s.room_id = q.room_id and s.round_no = q.round_no
      where q.room_id = g.room_id)
  )
  from public.just_one_games g
  where g.room_id = p_room_id
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table public.just_one_games    enable row level security;
alter table public.just_one_secrets  enable row level security;
alter table public.just_one_clues    enable row level security;
alter table public.just_one_guesses  enable row level security;
alter table private.just_one_words   enable row level security;
alter table private.just_one_decks   enable row level security;

revoke all on
  public.just_one_games, public.just_one_secrets,
  public.just_one_clues, public.just_one_guesses
from anon, authenticated;
grant select on
  public.just_one_games, public.just_one_secrets,
  public.just_one_clues, public.just_one_guesses
to authenticated;

create policy "members can read the game" on public.just_one_games
  for select to authenticated using (private.is_member(room_id));

create policy "members can read guesses" on public.just_one_guesses
  for select to authenticated using (private.is_member(room_id));

-- The mystery word: hidden from the guesser until the round is over.
create policy "word is hidden from the guesser" on public.just_one_secrets
  for select to authenticated using (
    private.is_member(room_id)
    and exists (
      select 1 from public.just_one_games g
      where g.room_id = just_one_secrets.room_id
        and (
          just_one_secrets.round_no < g.round_no
          or (just_one_secrets.round_no = g.round_no
              and (g.phase in ('round_result', 'game_over')
                   or g.guesser_id <> (select auth.uid())))
        )
    )
  );

-- Clues:
--   * your own: always
--   * other clue-givers: from the review step on (no copying while writing)
--   * the guesser: only surviving clues once guessing, all after the round
create policy "clues are revealed step by step" on public.just_one_clues
  for select to authenticated using (
    private.is_member(room_id)
    and (
      player_id = (select auth.uid())
      or exists (
        select 1 from public.just_one_games g
        where g.room_id = just_one_clues.room_id
          and (
            just_one_clues.round_no < g.round_no
            or (just_one_clues.round_no = g.round_no and (
              g.phase in ('round_result', 'game_over')
              or (g.guesser_id <> (select auth.uid())
                  and g.phase in ('reviewing_clues', 'guessing'))
              or (g.guesser_id = (select auth.uid())
                  and g.phase = 'guessing'
                  and not just_one_clues.auto_cancelled
                  and not just_one_clues.manual_cancelled)
            ))
          )
      )
    )
  );

revoke execute on function
  public.just_one_start(uuid),
  public.just_one_accept_word(uuid, int),
  public.just_one_skip_word(uuid, int, text),
  public.just_one_submit_clue(uuid, int, text),
  public.just_one_toggle_clue(uuid, int, uuid),
  public.just_one_confirm_review(uuid, int),
  public.just_one_submit_guess(uuid, int, text),
  public.just_one_accept_guess(uuid, int),
  public.just_one_next_round(uuid, int),
  public.just_one_force_continue(uuid, int),
  public.just_one_skip_round(uuid, int),
  public.just_one_snapshot(uuid)
from public, anon;

grant execute on function
  public.just_one_start(uuid),
  public.just_one_accept_word(uuid, int),
  public.just_one_skip_word(uuid, int, text),
  public.just_one_submit_clue(uuid, int, text),
  public.just_one_toggle_clue(uuid, int, uuid),
  public.just_one_confirm_review(uuid, int),
  public.just_one_submit_guess(uuid, int, text),
  public.just_one_accept_guess(uuid, int),
  public.just_one_next_round(uuid, int),
  public.just_one_force_continue(uuid, int),
  public.just_one_skip_round(uuid, int),
  public.just_one_snapshot(uuid)
to authenticated;
