-- Imposter: everyone but one player knows which of 16 words is the secret one.

insert into public.game_types (id, min_players, max_players)
values ('imposter', 3, 10);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table private.imposter_categories (
  name  text primary key,
  words text[] not null check (cardinality(words) = 16)
);

-- Everything in this table is public within the room.
create table public.imposter_games (
  room_id          uuid primary key references public.rooms (id) on delete cascade,
  phase            text not null check (phase in (
                     'hints', 'voting', 'guessing', 'round_result', 'game_over')),
  round_no         int not null,
  category         text not null,
  grid             text[] not null,
  -- Players of this round, in speaking order.
  player_ids       uuid[] not null,
  voted_ids        uuid[] not null default '{}',
  -- 1, or 2 for the run-off after a tie.
  vote_no          int not null default 1,
  -- The tied players during a run-off, otherwise empty.
  candidate_ids    uuid[] not null default '{}',
  used_categories  text[] not null default '{}',
  -- Filled in only once the round reveals them.
  imposter_id      uuid,
  word             text,
  guess            text,
  accused_id       uuid,
  outcome          text check (outcome in (
                     'escaped', 'caught_guessed', 'caught_missed', 'cancelled'))
);

-- One row per player and round. Players can only ever read their own.
create table public.imposter_roles (
  room_id     uuid not null references public.rooms (id) on delete cascade,
  round_no    int not null,
  player_id   uuid not null,
  is_imposter boolean not null,
  -- null for the imposter
  word        text,
  primary key (room_id, round_no, player_id)
);

create table public.imposter_votes (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  round_no  int not null,
  vote_no   int not null,
  voter_id  uuid not null,
  target_id uuid not null,
  primary key (room_id, round_no, vote_no, voter_id)
);

create table public.imposter_scores (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  player_id uuid not null,
  score     int not null default 0,
  primary key (room_id, player_id)
);

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function private.imposter_new_round(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game     public.imposter_games;
  v_used     text[];
  v_category private.imposter_categories;
  v_grid     text[];
  v_word     text;
  v_players  uuid[];
  v_start    int;
  v_imposter uuid;
begin
  select * into v_game from public.imposter_games where room_id = p_room_id;
  v_used := v_game.used_categories;

  -- No category twice until all of them have been played.
  select * into v_category from private.imposter_categories
  where name <> all (v_used) order by random() limit 1;
  if not found then
    v_used := '{}';
    select * into v_category from private.imposter_categories
    where name is distinct from v_game.category order by random() limit 1;
  end if;

  select array_agg(w order by random()) into v_grid
  from unnest(v_category.words) w;
  v_word := v_grid[1 + floor(random() * cardinality(v_grid))::int];

  -- Speaking order follows the seats, starting with a random player.
  select array_agg(user_id order by seat_order) into v_players
  from public.players where room_id = p_room_id;
  v_start := 1 + floor(random() * cardinality(v_players))::int;
  v_players := v_players[v_start:] || v_players[:v_start - 1];
  v_imposter := v_players[1 + floor(random() * cardinality(v_players))::int];

  update public.imposter_games set
    phase = 'hints',
    round_no = v_game.round_no + 1,
    category = v_category.name,
    grid = v_grid,
    player_ids = v_players,
    voted_ids = '{}',
    vote_no = 1,
    candidate_ids = '{}',
    used_categories = array_append(v_used, v_category.name),
    imposter_id = null,
    word = null,
    guess = null,
    accused_id = null,
    outcome = null
  where room_id = p_room_id;

  insert into public.imposter_roles (room_id, round_no, player_id, is_imposter, word)
  select p_room_id, v_game.round_no + 1, p, p = v_imposter,
         case when p <> v_imposter then v_word end
  from unnest(v_players) p;

  update public.rooms set open_to_join = false where id = p_room_id;
end $$;

-- Reveals imposter and word, and hands out the points.
create function private.imposter_finish(p_room_id uuid, p_outcome text) returns void
language plpgsql set search_path = '' as $$
declare
  v_game     public.imposter_games;
  v_imposter uuid;
  v_word     text;
begin
  select * into v_game from public.imposter_games where room_id = p_room_id;
  select player_id into v_imposter from public.imposter_roles
  where room_id = p_room_id and round_no = v_game.round_no and is_imposter;
  select word into v_word from public.imposter_roles
  where room_id = p_room_id and round_no = v_game.round_no and word is not null
  limit 1;

  update public.imposter_games set
    phase = 'round_result',
    outcome = p_outcome,
    imposter_id = v_imposter,
    word = v_word
  where room_id = p_room_id;

  insert into public.imposter_scores as s (room_id, player_id, score)
  select p_room_id, p,
         case p_outcome
           when 'escaped' then 2
           else 1
         end
  from unnest(v_game.player_ids) p
  where case p_outcome
          when 'escaped' then p = v_imposter
          when 'caught_guessed' then p = v_imposter
          when 'caught_missed' then p <> v_imposter
          else false
        end
  on conflict (room_id, player_id)
  do update set score = s.score + excluded.score;

  update public.rooms set open_to_join = true where id = p_room_id;
end $$;

-- Counts the votes once voting is over.
create function private.imposter_resolve(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_game public.imposter_games;
  v_top  uuid[];
begin
  select * into v_game from public.imposter_games where room_id = p_room_id;

  with tally as (
    select target_id, count(*) as votes
    from public.imposter_votes
    where room_id = p_room_id and round_no = v_game.round_no
      and vote_no = v_game.vote_no
    group by target_id
  )
  select array_agg(target_id) into v_top
  from tally where votes = (select max(votes) from tally);

  if cardinality(v_top) > 1 then
    if v_game.vote_no = 1 then
      update public.imposter_games
      set vote_no = 2, candidate_ids = v_top, voted_ids = '{}'
      where room_id = p_room_id;
    else
      perform private.imposter_finish(p_room_id, 'escaped');
    end if;
    return;
  end if;

  update public.imposter_games set accused_id = v_top[1]
  where room_id = p_room_id;

  if exists (select 1 from public.imposter_roles
             where room_id = p_room_id and round_no = v_game.round_no
               and player_id = v_top[1] and is_imposter) then
    -- Caught: everyone learns who it was, but not yet the word.
    update public.imposter_games
    set phase = 'guessing', imposter_id = v_top[1]
    where room_id = p_room_id;
  else
    perform private.imposter_finish(p_room_id, 'escaped');
  end if;
end $$;

-- Common checks for every in-game action. p_round_no guards against stale or
-- double clicks.
create function private.imposter_action(
  p_room_id uuid, p_round_no int, p_phases text[], p_host_only boolean)
returns public.imposter_games
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
  v_game public.imposter_games;
begin
  select * into v_game from public.imposter_games where room_id = p_room_id;
  if not found or v_room.status <> 'playing'
     or v_game.round_no <> p_round_no
     or v_game.phase <> all (p_phases) then
    raise exception 'wrong_phase';
  end if;
  if p_host_only and v_room.host_id <> auth.uid() then
    raise exception 'not_host';
  end if;
  return v_game;
end $$;

-- ---------------------------------------------------------------------------
-- Game functions (callable by clients)
-- ---------------------------------------------------------------------------

create function public.imposter_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  if v_room.host_id <> auth.uid() then
    raise exception 'not_host';
  end if;
  if v_room.status <> 'lobby' or v_room.game_type <> 'imposter' then
    raise exception 'wrong_phase';
  end if;
  if (select count(*) from public.players where room_id = p_room_id) < 3 then
    raise exception 'not_enough_players';
  end if;

  delete from public.imposter_games  where room_id = p_room_id;
  delete from public.imposter_roles  where room_id = p_room_id;
  delete from public.imposter_votes  where room_id = p_room_id;
  delete from public.imposter_scores where room_id = p_room_id;

  -- A placeholder row, filled by the first round.
  insert into public.imposter_games
    (room_id, phase, round_no, category, grid, player_ids)
  values (p_room_id, 'hints', 0, '', '{}', '{}');
  perform private.imposter_new_round(p_room_id);

  update public.rooms set status = 'playing' where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

create function public.imposter_open_voting(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.imposter_action(p_room_id, p_round_no, array['hints'], true);
  update public.imposter_games set phase = 'voting' where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- A vote can be changed until the last one is in. p_vote_no keeps a late click
-- from the first vote out of the run-off.
create function public.imposter_vote(
  p_room_id uuid, p_round_no int, p_vote_no int, p_target_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.imposter_games := private.imposter_action(
           p_room_id, p_round_no, array['voting'], false);
  v_voted int;
begin
  if v_game.vote_no <> p_vote_no then
    raise exception 'wrong_phase';
  end if;
  if auth.uid() <> all (v_game.player_ids) then
    raise exception 'wrong_role';
  end if;
  if p_target_id is null
     or p_target_id = auth.uid()
     or p_target_id <> all (v_game.player_ids)
     or (cardinality(v_game.candidate_ids) > 0
         and p_target_id <> all (v_game.candidate_ids)) then
    raise exception 'invalid_vote';
  end if;

  insert into public.imposter_votes
    (room_id, round_no, vote_no, voter_id, target_id)
  values (p_room_id, p_round_no, p_vote_no, auth.uid(), p_target_id)
  on conflict (room_id, round_no, vote_no, voter_id)
  do update set target_id = excluded.target_id;

  update public.imposter_games
  set voted_ids = array_append(array_remove(voted_ids, auth.uid()), auth.uid())
  where room_id = p_room_id
  returning cardinality(voted_ids) into v_voted;

  if v_voted >= cardinality(v_game.player_ids) then
    perform private.imposter_resolve(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

-- Host tool: count the votes without people who are offline.
create function public.imposter_close_voting(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.imposter_games := private.imposter_action(
           p_room_id, p_round_no, array['voting'], true);
begin
  if exists (select 1 from unnest(v_game.player_ids) p
             where p <> auth.uid() and p <> all (v_game.voted_ids)
               and not private.is_stale(p_room_id, p))
     or auth.uid() <> all (v_game.voted_ids) then
    raise exception 'players_still_here';
  end if;
  if cardinality(v_game.voted_ids) = 0 then
    raise exception 'no_votes_yet';
  end if;
  perform private.imposter_resolve(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- The caught imposter's one guess.
create function public.imposter_guess(
  p_room_id uuid, p_round_no int, p_word text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.imposter_games := private.imposter_action(
           p_room_id, p_round_no, array['guessing'], false);
begin
  if v_game.imposter_id <> auth.uid() then
    raise exception 'wrong_role';
  end if;
  if p_word is null or p_word <> all (v_game.grid) then
    raise exception 'invalid_guess';
  end if;

  update public.imposter_games set guess = p_word where room_id = p_room_id;
  perform private.imposter_finish(p_room_id, case
    when exists (select 1 from public.imposter_roles
                 where room_id = p_room_id and round_no = p_round_no
                   and word = p_word)
    then 'caught_guessed' else 'caught_missed' end);
  perform private.touch(p_room_id);
end $$;

-- Host tool: an imposter who went offline doesn't get to guess.
create function public.imposter_skip_guess(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.imposter_games := private.imposter_action(
           p_room_id, p_round_no, array['guessing'], true);
begin
  if v_game.imposter_id = auth.uid()
     or not private.is_stale(p_room_id, v_game.imposter_id) then
    raise exception 'players_still_here';
  end if;
  perform private.imposter_finish(p_room_id, 'caught_missed');
  perform private.touch(p_room_id);
end $$;

-- Host tool: end the round without points. Not possible once the imposter has
-- been caught.
create function public.imposter_cancel_round(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.imposter_action(
    p_room_id, p_round_no, array['hints', 'voting'], true);
  perform private.imposter_finish(p_room_id, 'cancelled');
  perform private.touch(p_room_id);
end $$;

create function public.imposter_next_round(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.imposter_action(
    p_room_id, p_round_no, array['round_result'], true);
  if (select count(*) from public.players where room_id = p_room_id) < 3 then
    raise exception 'not_enough_players';
  end if;
  perform private.imposter_new_round(p_room_id);
  perform private.touch(p_room_id);
end $$;

create function public.imposter_end_game(p_room_id uuid, p_round_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.imposter_action(
    p_room_id, p_round_no, array['round_result'], true);
  update public.imposter_games set phase = 'game_over' where room_id = p_room_id;
  update public.rooms set status = 'finished', open_to_join = false
  where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Keeps a running game consistent when a player leaves or is kicked.
create function private.imposter_player_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_game      public.imposter_games;
  v_too_few   boolean;
  v_in_round  boolean;
begin
  if not exists (select 1 from public.rooms
                 where id = old.room_id and status = 'playing') then
    return null;
  end if;
  select * into v_game from public.imposter_games where room_id = old.room_id;
  if not found then
    return null;
  end if;

  v_too_few := (select count(*) from public.players
                where room_id = old.room_id) < 3;
  v_in_round := v_game.phase in ('hints', 'voting', 'guessing');

  if v_too_few then
    if v_in_round then
      perform private.imposter_finish(old.room_id, 'cancelled');
    end if;
    update public.imposter_games set phase = 'game_over'
    where room_id = old.room_id;
    update public.rooms set status = 'finished', open_to_join = false
    where id = old.room_id;
    return null;
  end if;

  if not v_in_round or old.user_id <> all (v_game.player_ids) then
    return null;
  end if;

  if exists (select 1 from public.imposter_roles
             where room_id = old.room_id and round_no = v_game.round_no
               and player_id = old.user_id and is_imposter) then
    perform private.imposter_finish(old.room_id, 'cancelled');
    return null;
  end if;

  -- Votes by or for the person who left are void.
  update public.imposter_games set
    player_ids = array_remove(player_ids, old.user_id),
    candidate_ids = array_remove(candidate_ids, old.user_id),
    voted_ids = array(
      select v from unnest(voted_ids) v
      where v <> old.user_id and not exists (
        select 1 from public.imposter_votes x
        where x.room_id = old.room_id and x.round_no = v_game.round_no
          and x.vote_no = v_game.vote_no and x.voter_id = v
          and x.target_id = old.user_id))
  where room_id = old.room_id;

  delete from public.imposter_votes
  where room_id = old.room_id and round_no = v_game.round_no
    and vote_no = v_game.vote_no
    and (voter_id = old.user_id or target_id = old.user_id);

  select * into v_game from public.imposter_games where room_id = old.room_id;

  -- A run-off needs at least two candidates, otherwise vote afresh.
  if v_game.vote_no = 2 and cardinality(v_game.candidate_ids) < 2 then
    delete from public.imposter_votes
    where room_id = old.room_id and round_no = v_game.round_no;
    update public.imposter_games
    set vote_no = 1, candidate_ids = '{}', voted_ids = '{}'
    where room_id = old.room_id;
  elsif v_game.phase = 'voting'
        and cardinality(v_game.voted_ids) >= cardinality(v_game.player_ids) then
    perform private.imposter_resolve(old.room_id);
  end if;
  return null;
end $$;

create trigger imposter_player_removed
after delete on public.players
for each row execute function private.imposter_player_removed();

-- One consistent view of the game. Runs with the caller's rights, so RLS
-- decides what is in it: only your own role, and no votes before the reveal.
create function public.imposter_snapshot(p_room_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'game', to_jsonb(g) - 'used_categories',
    'role', (
      select jsonb_build_object('is_imposter', r.is_imposter, 'word', r.word)
      from public.imposter_roles r
      where r.room_id = g.room_id and r.round_no = g.round_no
        and r.player_id = (select auth.uid())),
    'votes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'vote_no', v.vote_no, 'voter_id', v.voter_id,
               'target_id', v.target_id)
               order by v.vote_no, v.voter_id), '[]'::jsonb)
      from public.imposter_votes v
      where v.room_id = g.room_id and v.round_no = g.round_no),
    'scores', (
      select coalesce(jsonb_object_agg(s.player_id, s.score), '{}'::jsonb)
      from public.imposter_scores s where s.room_id = g.room_id)
  )
  from public.imposter_games g
  where g.room_id = p_room_id
$$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table private.imposter_categories enable row level security;
alter table public.imposter_games  enable row level security;
alter table public.imposter_roles  enable row level security;
alter table public.imposter_votes  enable row level security;
alter table public.imposter_scores enable row level security;

revoke all on
  public.imposter_games, public.imposter_roles,
  public.imposter_votes, public.imposter_scores
from anon, authenticated;
grant select on
  public.imposter_games, public.imposter_roles,
  public.imposter_votes, public.imposter_scores
to authenticated;

create policy "members can read the game" on public.imposter_games
  for select to authenticated using (private.is_member(room_id));

create policy "members can read scores" on public.imposter_scores
  for select to authenticated using (private.is_member(room_id));

-- Nobody can read another player's role, not even after the round.
create policy "players can read only their own role" on public.imposter_roles
  for select to authenticated using (
    private.is_member(room_id) and player_id = (select auth.uid()));

-- Your own vote is always visible. Others appear once that vote is over.
create policy "votes are secret until counted" on public.imposter_votes
  for select to authenticated using (
    private.is_member(room_id)
    and (
      voter_id = (select auth.uid())
      or exists (
        select 1 from public.imposter_games g
        where g.room_id = imposter_votes.room_id
          and (
            imposter_votes.round_no < g.round_no
            or (imposter_votes.round_no = g.round_no and (
              g.phase in ('guessing', 'round_result', 'game_over')
              or imposter_votes.vote_no < g.vote_no))
          )
      )
    )
  );

revoke execute on function
  public.imposter_start(uuid),
  public.imposter_open_voting(uuid, int),
  public.imposter_vote(uuid, int, int, uuid),
  public.imposter_close_voting(uuid, int),
  public.imposter_guess(uuid, int, text),
  public.imposter_skip_guess(uuid, int),
  public.imposter_cancel_round(uuid, int),
  public.imposter_next_round(uuid, int),
  public.imposter_end_game(uuid, int),
  public.imposter_snapshot(uuid)
from public, anon;

grant execute on function
  public.imposter_start(uuid),
  public.imposter_open_voting(uuid, int),
  public.imposter_vote(uuid, int, int, uuid),
  public.imposter_close_voting(uuid, int),
  public.imposter_guess(uuid, int, text),
  public.imposter_skip_guess(uuid, int),
  public.imposter_cancel_round(uuid, int),
  public.imposter_next_round(uuid, int),
  public.imposter_end_game(uuid, int),
  public.imposter_snapshot(uuid)
to authenticated;
