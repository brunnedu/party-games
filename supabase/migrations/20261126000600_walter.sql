-- Der wahre Walter. One player, the Sphinx, completes a sentence truthfully; the
-- others invent fakes in the Sphinx's name. The Sphinx reads all of them out,
-- the others vote by number.
--
-- Secrecy: until the reveal, players can only read their own answer. The Sphinx
-- gets the texts (never the authors) through a function. The reveal is copied
-- into a public table step by step.

insert into public.game_types (id, min_players, max_players)
values ('walter', 3, 10);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- "WALTER" marks the gap.
create table private.walter_sentences (
  sentence text primary key check (position('WALTER' in sentence) > 0)
);

-- Everything in this table is public within the room.
create table public.walter_games (
  room_id        uuid primary key references public.rooms (id) on delete cascade,
  phase          text not null check (phase in (
                   'choosing', 'writing', 'voting', 'reveal', 'game_over')),
  -- Counts every attempt, including replaced ones.
  round_no       int not null,
  rounds_played  int not null default 0,
  rounds_total   int not null,
  sphinx_id      uuid not null,
  sphinx_seat    int not null,
  sentence       text,
  -- Players of this round, including the Sphinx.
  player_ids     uuid[] not null default '{}',
  submitted_ids  uuid[] not null default '{}',
  voted_ids      uuid[] not null default '{}',
  -- Answers are numbered 1..answer_count once reading starts.
  answer_count   int not null default 0,
  reveal_step    int not null default 0,
  reveal_steps   int not null default 0,
  -- Filled in when the reveal is complete.
  round_points   jsonb,
  sphinx_foul    boolean not null default false,
  used_sentences text[] not null default '{}'
);

-- The three sentences the Sphinx can pick from.
create table public.walter_choices (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  round_no  int not null,
  sphinx_id uuid not null,
  options   text[] not null,
  primary key (room_id, round_no)
);

create table public.walter_answers (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  round_no  int not null,
  player_id uuid not null,
  answer    text not null,
  -- Order while practising; becomes the numbering.
  sort_key  double precision not null default random(),
  number    int,
  primary key (room_id, round_no, player_id)
);

create table public.walter_votes (
  room_id  uuid not null references public.rooms (id) on delete cascade,
  round_no int not null,
  voter_id uuid not null,
  number   int not null,
  primary key (room_id, round_no, voter_id)
);

-- What gets revealed together (matching answers form one group), in order.
create table private.walter_plan (
  room_id  uuid not null references public.rooms (id) on delete cascade,
  round_no int not null,
  position int not null,
  numbers  int[] not null,
  kind     text not null check (kind in ('voted', 'truth', 'unvoted')),
  primary key (room_id, round_no, position)
);

-- The public side of the reveal. is_truth and the authors arrive with the
-- second step.
create table public.walter_reveals (
  room_id  uuid not null references public.rooms (id) on delete cascade,
  round_no int not null,
  position int not null,
  -- [{ "number": 2, "answer": "..." }], later also "player_id" and "is_real"
  entries  jsonb not null,
  -- [{ "voter_id": "...", "number": 2 }]
  votes    jsonb not null,
  resolved boolean not null default false,
  is_truth boolean,
  primary key (room_id, round_no, position)
);

create table public.walter_scores (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  player_id uuid not null,
  score     int not null default 0,
  primary key (room_id, player_id)
);

create table public.walter_history (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  round_no  int not null,
  sphinx_id uuid not null,
  sentence  text not null,
  truth     text not null,
  primary key (room_id, round_no)
);

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Answers match if they differ only in capitals, punctuation and spaces.
create function private.walter_normalize(p_text text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(
    btrim(regexp_replace(
      regexp_replace(lower(normalize(p_text, nfc)), '[''’`´]', '', 'g'),
      '(\s|[!"#$%&()*+,./:;<=>?@\[\]\\^_{|}~«»‹›„“”‚‘…–—¡¿-])+', ' ', 'g')),
    ''), btrim(p_text))
$$;

create function private.walter_new_round(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game    public.walter_games;
  v_sphinx  public.players;
  v_options text[];
  v_used    text[];
begin
  select * into v_game from public.walter_games where room_id = p_room_id;
  v_used := v_game.used_sentences;

  select * into v_sphinx from public.players
  where room_id = p_room_id
  order by (seat_order <= v_game.sphinx_seat), seat_order
  limit 1;

  if (select count(*) from private.walter_sentences
      where sentence <> all (v_used)) < 3 then
    v_used := '{}';
  end if;
  select array_agg(sentence) into v_options from (
    select sentence from private.walter_sentences
    where sentence <> all (v_used)
    order by random() limit 3) picked;

  update public.walter_games set
    phase = 'choosing',
    round_no = v_game.round_no + 1,
    sphinx_id = v_sphinx.user_id,
    sphinx_seat = v_sphinx.seat_order,
    sentence = null,
    player_ids = array(select user_id from public.players
                       where room_id = p_room_id order by seat_order),
    submitted_ids = '{}',
    voted_ids = '{}',
    answer_count = 0,
    reveal_step = 0,
    reveal_steps = 0,
    round_points = null,
    sphinx_foul = false,
    used_sentences = v_used
  where room_id = p_room_id;

  insert into public.walter_choices (room_id, round_no, sphinx_id, options)
  values (p_room_id, v_game.round_no + 1, v_sphinx.user_id, v_options);

  update public.rooms set open_to_join = false where id = p_room_id;
end $$;

-- Common checks for every in-game action. p_round_no guards against stale or
-- double clicks. p_role is 'sphinx', 'guesser' (a player of this round other
-- than the Sphinx), 'player' (anyone in this round) or 'any'.
create function private.walter_action(
  p_room_id uuid, p_round_no int, p_phases text[], p_role text)
returns public.walter_games
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
  v_game public.walter_games;
begin
  select * into v_game from public.walter_games where room_id = p_room_id;
  if not found or v_room.status <> 'playing'
     or v_game.round_no <> p_round_no
     or v_game.phase <> all (p_phases) then
    raise exception 'wrong_phase';
  end if;
  if (p_role = 'sphinx' and v_game.sphinx_id <> auth.uid())
     or (p_role = 'guesser' and (v_game.sphinx_id = auth.uid()
                                 or auth.uid() <> all (v_game.player_ids)))
     or (p_role = 'player' and auth.uid() <> all (v_game.player_ids)) then
    raise exception 'wrong_role';
  end if;
  return v_game;
end $$;

-- Voting is over: decide what is revealed in which order. Fakes with votes come
-- first (fewest first), then the truth, then the fakes nobody picked.
create function private.walter_make_plan(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game  public.walter_games;
  v_truth text;
begin
  select * into v_game from public.walter_games where room_id = p_room_id;
  select private.walter_normalize(answer) into v_truth
  from public.walter_answers
  where room_id = p_room_id and round_no = v_game.round_no
    and player_id = v_game.sphinx_id;

  with answers as (
    select number, private.walter_normalize(answer) as norm
    from public.walter_answers
    where room_id = p_room_id and round_no = v_game.round_no
      and number is not null
  ),
  grouped as (
    select a.norm,
           array_agg(distinct a.number order by a.number) as numbers,
           count(v.voter_id) as votes
    from answers a
    left join public.walter_votes v
      on v.room_id = p_room_id and v.round_no = v_game.round_no
     and v.number = a.number
    group by a.norm
  ),
  kinds as (
    select numbers, votes,
           case when norm = v_truth then 'truth'
                when votes > 0 then 'voted'
                else 'unvoted' end as kind
    from grouped
  )
  insert into private.walter_plan (room_id, round_no, position, numbers, kind)
  select p_room_id, v_game.round_no,
         row_number() over (
           order by case kind when 'voted' then 1 when 'truth' then 2 else 3 end,
                    votes, random()),
         numbers, kind
  from kinds;

  -- Voted fakes and the truth take two steps, unvoted fakes one.
  update public.walter_games set
    phase = 'reveal',
    reveal_step = 0,
    reveal_steps = (
      select sum(case when kind = 'unvoted' then 1 else 2 end)
      from private.walter_plan
      where room_id = p_room_id and round_no = v_game.round_no)
  where room_id = p_room_id;
end $$;

-- Hands out the points. Called when the reveal is complete, so that no score
-- gives anything away earlier.
create function private.walter_award(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game    public.walter_games;
  v_truth   public.walter_answers;
  v_norm    text;
  v_matched boolean;
  v_correct int;
  v_voters  int;
  v_foul    boolean;
  v_points  jsonb;
begin
  select * into v_game from public.walter_games where room_id = p_room_id;
  select * into v_truth from public.walter_answers
  where room_id = p_room_id and round_no = v_game.round_no
    and player_id = v_game.sphinx_id;
  v_norm := private.walter_normalize(v_truth.answer);

  -- Did someone else write the same as the Sphinx?
  v_matched := (select count(*) > 1 from public.walter_answers a
                where a.room_id = p_room_id and a.round_no = v_game.round_no
                  and a.number is not null
                  and private.walter_normalize(a.answer) = v_norm);

  select count(*),
         count(*) filter (where private.walter_normalize(a.answer) = v_norm)
  into v_voters, v_correct
  from public.walter_votes v
  join public.walter_answers a
    on a.room_id = v.room_id and a.round_no = v.round_no and a.number = v.number
  where v.room_id = p_room_id and v.round_no = v_game.round_no;

  -- If everyone finds the truth, the Sphinx gets nothing (4+ players only).
  v_foul := cardinality(v_game.player_ids) >= 4
            and v_voters > 0 and v_correct = v_voters;

  with answers as (
    select a.player_id, a.number, private.walter_normalize(a.answer) as norm
    from public.walter_answers a
    where a.room_id = p_room_id and a.round_no = v_game.round_no
      and a.number is not null
  ),
  votes as (
    select v.voter_id, a.player_id as author_id, a.norm
    from public.walter_votes v
    join answers a on a.number = v.number
    where v.room_id = p_room_id and v.round_no = v_game.round_no
  ),
  earned as (
    -- Picking the truth always counts.
    select voter_id as player_id, 1 as points from votes where norm = v_norm
    union all
    -- A fake earns a point per vote, unless somebody wrote the same.
    select votes.author_id, 1 from votes
    where votes.norm <> v_norm
      and (select count(*) from answers x where x.norm = votes.norm) = 1
    union all
    -- The Sphinx earns a point per correct vote.
    select v_game.sphinx_id, 1 from votes
    where norm = v_norm and not v_matched and not v_foul
  )
  select coalesce(jsonb_object_agg(player_id, total), '{}'::jsonb) into v_points
  from (select player_id, sum(points) as total from earned group by player_id) t;

  insert into public.walter_scores as s (room_id, player_id, score)
  select p_room_id, key::uuid, value::int from jsonb_each_text(v_points)
  on conflict (room_id, player_id)
  do update set score = s.score + excluded.score;

  insert into public.walter_history (room_id, round_no, sphinx_id, sentence, truth)
  values (p_room_id, v_game.round_no, v_game.sphinx_id, v_game.sentence,
          v_truth.answer);

  update public.walter_games set
    round_points = v_points,
    sphinx_foul = v_foul and not v_matched,
    rounds_played = rounds_played + 1
  where room_id = p_room_id;

  update public.rooms set open_to_join = true where id = p_room_id;
end $$;

-- What the caller may know beyond their own rows. Callable by clients, so it
-- checks everything itself.
create function public.walter_private_view(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_game public.walter_games;
  v_list jsonb;
  v_twin boolean := false;
begin
  if not private.is_member(p_room_id) then
    return null;
  end if;
  select * into v_game from public.walter_games where room_id = p_room_id;

  -- The Sphinx sees all texts, but only after locking in their own answer, and
  -- never who wrote which fake.
  if v_game.sphinx_id = auth.uid() and auth.uid() = any (v_game.submitted_ids)
     and v_game.phase in ('writing', 'voting', 'reveal') then
    select jsonb_agg(jsonb_build_object(
             'answer', a.answer,
             'number', a.number,
             'is_real', a.player_id = auth.uid())
           order by a.number, a.sort_key)
    into v_list
    from public.walter_answers a
    where a.room_id = p_room_id and a.round_no = v_game.round_no
      and (v_game.phase = 'writing' or a.number is not null);
  end if;

  -- Whether somebody wrote the same as you: then you may vote for your answer.
  if v_game.phase = 'voting' then
    v_twin := exists (
      select 1 from public.walter_answers mine
      join public.walter_answers other
        on other.room_id = mine.room_id and other.round_no = mine.round_no
       and other.player_id <> mine.player_id and other.number is not null
       and private.walter_normalize(other.answer)
         = private.walter_normalize(mine.answer)
      where mine.room_id = p_room_id and mine.round_no = v_game.round_no
        and mine.player_id = auth.uid());
  end if;

  return jsonb_build_object('sphinx_answers', v_list, 'has_twin', v_twin);
end $$;

-- ---------------------------------------------------------------------------
-- Game functions (callable by clients)
-- ---------------------------------------------------------------------------

create function public.walter_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms := private.lock_room(p_room_id);
  v_count int;
  v_first public.players;
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'walter' then
    raise exception 'wrong_phase';
  end if;
  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < 3 then
    raise exception 'not_enough_players';
  end if;

  delete from public.walter_games   where room_id = p_room_id;
  delete from public.walter_choices where room_id = p_room_id;
  delete from public.walter_answers where room_id = p_room_id;
  delete from public.walter_votes   where room_id = p_room_id;
  delete from public.walter_reveals where room_id = p_room_id;
  delete from public.walter_scores  where room_id = p_room_id;
  delete from public.walter_history where room_id = p_room_id;
  delete from private.walter_plan   where room_id = p_room_id;

  select * into v_first from public.players
  where room_id = p_room_id order by random() limit 1;

  -- Everyone is the Sphinx equally often: twice with 3-5 players, else once.
  insert into public.walter_games
    (room_id, phase, round_no, rounds_total, sphinx_id, sphinx_seat)
  values
    (p_room_id, 'choosing', 0, v_count * case when v_count <= 5 then 2 else 1 end,
     v_first.user_id, v_first.seat_order - 1);
  perform private.walter_new_round(p_room_id);

  update public.rooms set status = 'playing' where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

create function public.walter_choose(
  p_room_id uuid, p_round_no int, p_sentence text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.walter_action(p_room_id, p_round_no, array['choosing'], 'sphinx');
  if not exists (select 1 from public.walter_choices
                 where room_id = p_room_id and round_no = p_round_no
                   and p_sentence = any (options)) then
    raise exception 'invalid_action';
  end if;
  update public.walter_games set
    phase = 'writing',
    sentence = p_sentence,
    used_sentences = array_append(used_sentences, p_sentence)
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Answers are kept as typed. Fakes can be changed until reading starts; the
-- Sphinx's answer is final, because they see the fakes afterwards.
create function public.walter_submit(
  p_room_id uuid, p_round_no int, p_answer text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game   public.walter_games := private.walter_action(
             p_room_id, p_round_no, array['writing'], 'player');
  v_answer text := btrim(coalesce(p_answer, ''), E' \t\r\n');
begin
  if char_length(v_answer) < 1 or char_length(v_answer) > 100 then
    raise exception 'invalid_answer';
  end if;
  if v_game.sphinx_id = auth.uid() and auth.uid() = any (v_game.submitted_ids) then
    raise exception 'answer_locked';
  end if;

  insert into public.walter_answers (room_id, round_no, player_id, answer)
  values (p_room_id, p_round_no, auth.uid(), v_answer)
  on conflict (room_id, round_no, player_id)
  do update set answer = excluded.answer;

  update public.walter_games
  set submitted_ids = array_append(
        array_remove(submitted_ids, auth.uid()), auth.uid())
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

create function public.walter_shuffle(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.walter_games := private.walter_action(
    p_room_id, p_round_no, array['writing'], 'sphinx');
begin
  if auth.uid() <> all (v_game.submitted_ids) then
    raise exception 'wrong_phase';
  end if;
  update public.walter_answers set sort_key = random()
  where room_id = p_room_id and round_no = p_round_no;
  perform private.touch(p_room_id);
end $$;

-- Locks the order in which the Sphinx has practised the answers.
create function public.walter_start_reading(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.walter_games := private.walter_action(
    p_room_id, p_round_no, array['writing'], 'sphinx');
begin
  if not (v_game.player_ids <@ v_game.submitted_ids)
     or cardinality(v_game.player_ids) < 2 then
    raise exception 'answers_missing';
  end if;

  update public.walter_answers a set number = n.number
  from (select player_id,
               row_number() over (order by sort_key, player_id)::int as number
        from public.walter_answers
        where room_id = p_room_id and round_no = p_round_no) n
  where a.room_id = p_room_id and a.round_no = p_round_no
    and a.player_id = n.player_id;

  update public.walter_games set
    phase = 'voting',
    answer_count = (select count(*) from public.walter_answers
                    where room_id = p_room_id and round_no = p_round_no)
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

create function public.walter_vote(
  p_room_id uuid, p_round_no int, p_number int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.walter_games := private.walter_action(
    p_room_id, p_round_no, array['voting'], 'guesser');
  v_own  int;
begin
  if p_number is null or p_number not between 1 and v_game.answer_count then
    raise exception 'invalid_vote';
  end if;
  select number into v_own from public.walter_answers
  where room_id = p_room_id and round_no = p_round_no and player_id = auth.uid();
  -- Your own answer only if someone else wrote the same: it might be the truth.
  if p_number = v_own
     and not (public.walter_private_view(p_room_id) ->> 'has_twin')::boolean then
    raise exception 'invalid_vote';
  end if;

  insert into public.walter_votes (room_id, round_no, voter_id, number)
  values (p_room_id, p_round_no, auth.uid(), p_number)
  on conflict (room_id, round_no, voter_id)
  do update set number = excluded.number;

  update public.walter_games
  set voted_ids = array_append(array_remove(voted_ids, auth.uid()), auth.uid())
  where room_id = p_room_id;

  select * into v_game from public.walter_games where room_id = p_room_id;
  if array_remove(v_game.player_ids, v_game.sphinx_id) <@ v_game.voted_ids then
    perform private.walter_make_plan(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- One tap of the reveal. p_step is the step the caller sees, so a double tap
-- only advances once. The host may step in if the Sphinx is offline.
create function public.walter_reveal_next(
  p_room_id uuid, p_round_no int, p_step int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.walter_games := private.walter_action(
    p_room_id, p_round_no, array['reveal'], 'any');
  v_plan private.walter_plan;
  v_done int := 0;
  v_size int;
  v_first boolean;
begin
  if v_game.sphinx_id <> auth.uid() then
    perform private.require_host(p_room_id);
    if not private.is_stale(p_room_id, v_game.sphinx_id) then
      raise exception 'players_still_here';
    end if;
  end if;
  if p_step <> v_game.reveal_step or v_game.reveal_step >= v_game.reveal_steps then
    raise exception 'wrong_phase';
  end if;

  -- Find the group the next step belongs to.
  for v_plan in
    select * from private.walter_plan
    where room_id = p_room_id and round_no = p_round_no order by position
  loop
    v_size := case when v_plan.kind = 'unvoted' then 1 else 2 end;
    exit when v_game.reveal_step < v_done + v_size;
    v_done := v_done + v_size;
  end loop;
  v_first := v_game.reveal_step = v_done;

  if v_first then
    -- Answer and voters; authors only for fakes nobody picked.
    insert into public.walter_reveals
      (room_id, round_no, position, entries, votes, resolved, is_truth)
    select p_room_id, p_round_no, v_plan.position,
      (select jsonb_agg(jsonb_build_object('number', a.number, 'answer', a.answer)
                        order by a.number)
       from public.walter_answers a
       where a.room_id = p_room_id and a.round_no = p_round_no
         and a.number = any (v_plan.numbers)),
      (select coalesce(jsonb_agg(jsonb_build_object(
                'voter_id', v.voter_id, 'number', v.number)
                order by v.number, v.voter_id), '[]'::jsonb)
       from public.walter_votes v
       where v.room_id = p_room_id and v.round_no = p_round_no
         and v.number = any (v_plan.numbers)),
      false, null;
  end if;

  if not v_first or v_plan.kind = 'unvoted' then
    update public.walter_reveals set
      resolved = true,
      is_truth = v_plan.kind = 'truth',
      entries = (
        select jsonb_agg(jsonb_build_object(
                 'number', a.number, 'answer', a.answer,
                 'player_id', a.player_id,
                 'is_real', a.player_id = v_game.sphinx_id)
               order by a.number)
        from public.walter_answers a
        where a.room_id = p_room_id and a.round_no = p_round_no
          and a.number = any (v_plan.numbers))
    where room_id = p_room_id and round_no = p_round_no
      and position = v_plan.position;
  end if;

  update public.walter_games set reveal_step = reveal_step + 1
  where room_id = p_room_id;
  if v_game.reveal_step + 1 = v_game.reveal_steps then
    perform private.walter_award(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Host tool: go on without people who are offline. While writing, they sit this
-- round out; while voting, the votes that are in get counted.
create function public.walter_force_continue(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game    public.walter_games := private.walter_action(
              p_room_id, p_round_no, array['writing', 'voting'], 'any');
  v_missing uuid[];
begin
  perform private.require_host(p_room_id);

  select coalesce(array_agg(p), '{}') into v_missing
  from unnest(v_game.player_ids) p
  where case v_game.phase
          when 'writing' then p <> all (v_game.submitted_ids)
          else p <> all (v_game.voted_ids) and p <> v_game.sphinx_id
        end;

  if exists (select 1 from unnest(v_missing) p
             where p = auth.uid() or not private.is_stale(p_room_id, p)) then
    raise exception 'players_still_here';
  end if;

  if v_game.phase = 'writing' then
    if v_game.sphinx_id = any (v_missing)
       or cardinality(v_game.player_ids) - cardinality(v_missing) < 2 then
      raise exception 'answers_missing';
    end if;
    update public.walter_games set player_ids = array(
      select p from unnest(v_game.player_ids) with ordinality u(p, i)
      where p <> all (v_missing) order by i)
    where room_id = p_room_id;
  else
    if cardinality(v_game.voted_ids) = 0 then
      raise exception 'no_votes_yet';
    end if;
    perform private.walter_make_plan(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Host tool: replace a stuck round. It doesn't count towards the total.
create function public.walter_skip_round(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.walter_action(
    p_room_id, p_round_no, array['choosing', 'writing', 'voting'], 'any');
  perform private.require_host(p_room_id);
  perform private.walter_new_round(p_room_id);
  perform private.touch(p_room_id);
end $$;

create function public.walter_next_round(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.walter_games := private.walter_action(
    p_room_id, p_round_no, array['reveal'], 'any');
begin
  if v_game.reveal_step < v_game.reveal_steps then
    raise exception 'wrong_phase';
  end if;
  if v_game.sphinx_id <> auth.uid() then
    perform private.require_host(p_room_id);
  end if;

  if v_game.rounds_played >= v_game.rounds_total then
    update public.walter_games set phase = 'game_over' where room_id = p_room_id;
    update public.rooms set status = 'finished', open_to_join = false
    where id = p_room_id;
  else
    if (select count(*) from public.players where room_id = p_room_id) < 3 then
      raise exception 'not_enough_players';
    end if;
    perform private.walter_new_round(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Keeps a running game consistent when a player leaves or is kicked.
create function private.walter_player_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.walter_games;
begin
  if not exists (select 1 from public.rooms
                 where id = old.room_id and status = 'playing') then
    return null;
  end if;
  select * into v_game from public.walter_games where room_id = old.room_id;
  if not found then
    return null;
  end if;

  if (select count(*) from public.players where room_id = old.room_id) < 3 then
    update public.walter_games set phase = 'game_over' where room_id = old.room_id;
    update public.rooms set status = 'finished', open_to_join = false
    where id = old.room_id;
    return null;
  end if;

  -- The reveal can finish without them (the host can step in for the Sphinx).
  if v_game.phase = 'reveal' or old.user_id <> all (v_game.player_ids) then
    return null;
  end if;

  if v_game.sphinx_id = old.user_id then
    perform private.walter_new_round(old.room_id);
    return null;
  end if;

  -- Once answers are numbered and being read, theirs stays in.
  if v_game.phase = 'writing' then
    delete from public.walter_answers
    where room_id = old.room_id and round_no = v_game.round_no
      and player_id = old.user_id;
  end if;
  delete from public.walter_votes
  where room_id = old.room_id and round_no = v_game.round_no
    and voter_id = old.user_id;

  update public.walter_games set
    player_ids = array_remove(player_ids, old.user_id),
    submitted_ids = array_remove(submitted_ids, old.user_id),
    voted_ids = array_remove(voted_ids, old.user_id)
  where room_id = old.room_id;

  select * into v_game from public.walter_games where room_id = old.room_id;
  if cardinality(v_game.player_ids) < 2 then
    perform private.walter_new_round(old.room_id);
  elsif v_game.phase = 'voting'
        and array_remove(v_game.player_ids, v_game.sphinx_id)
            <@ v_game.voted_ids then
    perform private.walter_make_plan(old.room_id);
  end if;
  return null;
end $$;

create trigger walter_player_removed
after delete on public.players
for each row execute function private.walter_player_removed();

-- One consistent view of the game. Runs with the caller's rights, so RLS
-- decides what is in it.
create function public.walter_snapshot(p_room_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'game', to_jsonb(g) - 'used_sentences',
    'options', (
      select to_jsonb(c.options) from public.walter_choices c
      where c.room_id = g.room_id and c.round_no = g.round_no),
    'own', (
      select jsonb_build_object('answer', a.answer, 'number', a.number)
      from public.walter_answers a
      where a.room_id = g.room_id and a.round_no = g.round_no
        and a.player_id = (select auth.uid())),
    'own_vote', (
      select v.number from public.walter_votes v
      where v.room_id = g.room_id and v.round_no = g.round_no
        and v.voter_id = (select auth.uid())),
    'private', public.walter_private_view(g.room_id),
    'reveals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'position', r.position, 'entries', r.entries, 'votes', r.votes,
               'resolved', r.resolved, 'is_truth', r.is_truth)
               order by r.position), '[]'::jsonb)
      from public.walter_reveals r
      where r.room_id = g.room_id and r.round_no = g.round_no),
    'scores', (
      select coalesce(jsonb_object_agg(s.player_id, s.score), '{}'::jsonb)
      from public.walter_scores s where s.room_id = g.room_id),
    'history', (
      select coalesce(jsonb_agg(to_jsonb(h) - 'room_id' order by h.round_no),
                      '[]'::jsonb)
      from public.walter_history h where h.room_id = g.room_id)
  )
  from public.walter_games g
  where g.room_id = p_room_id
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table private.walter_sentences enable row level security;
alter table private.walter_plan      enable row level security;
alter table public.walter_games      enable row level security;
alter table public.walter_choices    enable row level security;
alter table public.walter_answers    enable row level security;
alter table public.walter_votes      enable row level security;
alter table public.walter_reveals    enable row level security;
alter table public.walter_scores     enable row level security;
alter table public.walter_history    enable row level security;

revoke all on
  public.walter_games, public.walter_choices, public.walter_answers,
  public.walter_votes, public.walter_reveals, public.walter_scores,
  public.walter_history
from anon, authenticated;
grant select on
  public.walter_games, public.walter_choices, public.walter_answers,
  public.walter_votes, public.walter_reveals, public.walter_scores,
  public.walter_history
to authenticated;

create policy "members can read the game" on public.walter_games
  for select to authenticated using (private.is_member(room_id));
create policy "members can read reveals" on public.walter_reveals
  for select to authenticated using (private.is_member(room_id));
create policy "members can read scores" on public.walter_scores
  for select to authenticated using (private.is_member(room_id));
create policy "members can read the history" on public.walter_history
  for select to authenticated using (private.is_member(room_id));

create policy "only the Sphinx sees the choices" on public.walter_choices
  for select to authenticated using (
    private.is_member(room_id) and sphinx_id = (select auth.uid()));

-- Nobody ever reads another player's rows. Revealed answers are copied to
-- walter_reveals.
create policy "players can read only their own answers" on public.walter_answers
  for select to authenticated using (
    private.is_member(room_id) and player_id = (select auth.uid()));
create policy "players can read only their own votes" on public.walter_votes
  for select to authenticated using (
    private.is_member(room_id) and voter_id = (select auth.uid()));

revoke execute on function
  public.walter_private_view(uuid),
  public.walter_start(uuid),
  public.walter_choose(uuid, int, text),
  public.walter_submit(uuid, int, text),
  public.walter_shuffle(uuid, int),
  public.walter_start_reading(uuid, int),
  public.walter_vote(uuid, int, int),
  public.walter_reveal_next(uuid, int, int),
  public.walter_force_continue(uuid, int),
  public.walter_skip_round(uuid, int),
  public.walter_next_round(uuid, int),
  public.walter_snapshot(uuid)
from public, anon;

grant execute on function
  public.walter_private_view(uuid),
  public.walter_start(uuid),
  public.walter_choose(uuid, int, text),
  public.walter_submit(uuid, int, text),
  public.walter_shuffle(uuid, int),
  public.walter_start_reading(uuid, int),
  public.walter_vote(uuid, int, int),
  public.walter_reveal_next(uuid, int, int),
  public.walter_force_continue(uuid, int),
  public.walter_skip_round(uuid, int),
  public.walter_next_round(uuid, int),
  public.walter_snapshot(uuid)
to authenticated;
