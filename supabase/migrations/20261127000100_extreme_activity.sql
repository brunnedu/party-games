-- Extreme Activity. Two teams, one "game phone" that is passed around. Everyone
-- first writes words; the same words are then played in five modes. The
-- database holds the words, the clock and the score.

insert into public.game_types (id, min_players, max_players)
-- One phone is enough: several people can enter their words on it.
values ('extreme-activity', 1, 10);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Chosen by the host. A phone_id of null means "the host's phone".
create table public.activity_settings (
  room_id   uuid primary key references public.rooms (id) on delete cascade,
  max_words int not null default 3 check (max_words between 1 and 6),
  phone_id  uuid
);

-- Everything in this table is public within the room.
create table public.activity_games (
  room_id         uuid primary key references public.rooms (id) on delete cascade,
  phase           text not null check (phase in (
                    'writing', 'ready', 'playing', 'paused', 'new_mode',
                    'summary', 'game_over')),
  turn_no         int not null default 1,
  -- 1 explain, 2 one word, 3 pantomime, 4 statue, 5 sound. 6: all done.
  mode            int not null default 1 check (mode between 1 and 6),
  -- The last mode in which the current turn saw a word.
  played_mode     int not null default 1 check (played_mode between 1 and 5),
  team            int not null default 0 check (team in (0, 1)),
  current_word_id bigint,
  -- Time left when the clock was last started or stopped.
  remaining_ms    int not null default 60000,
  running_since   timestamptz
);

-- Never readable by clients: functions hand out single words.
create table private.activity_words (
  id        bigint generated always as identity primary key,
  room_id   uuid not null references public.rooms (id) on delete cascade,
  author    text not null,
  added_by  uuid not null,
  -- True for the words of the person the phone belongs to.
  is_own    boolean not null,
  word      text not null,
  -- The last mode in which the word was guessed.
  done_mode int not null default 0
);
create index on private.activity_words (room_id);

-- One row per guess. The word that was open when the time ran out is stored
-- uncounted, so it can still be counted in the summary.
create table private.activity_points (
  id      bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  turn_no int not null,
  word_id bigint not null references private.activity_words (id) on delete cascade,
  mode    int not null,
  team    int not null,
  counted boolean not null
);
create index on private.activity_points (room_id);

alter table private.activity_words  enable row level security;
alter table private.activity_points enable row level security;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- The game phone: the chosen player, otherwise the host.
create function private.activity_phone(p_room_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    (select phone_id from public.activity_settings where room_id = p_room_id),
    (select host_id from public.rooms where id = p_room_id))
$$;

create function private.activity_time_left(p_game public.activity_games)
returns int
language sql volatile set search_path = '' as $$
  select case
    when p_game.running_since is null then p_game.remaining_ms
    else greatest(0, p_game.remaining_ms - floor(extract(epoch from
           clock_timestamp() - p_game.running_since) * 1000))::int
  end
$$;

-- Milliseconds since the time ran out; negative while there is time left.
create function private.activity_overtime(p_game public.activity_games)
returns numeric
language sql volatile set search_path = '' as $$
  select extract(epoch from clock_timestamp() - p_game.running_since) * 1000
         - p_game.remaining_ms
$$;

create function private.activity_draw(p_room_id uuid, p_mode int) returns bigint
language sql volatile set search_path = '' as $$
  select id from private.activity_words
  where room_id = p_room_id and done_mode < p_mode
  order by random() limit 1
$$;

create function private.activity_pause_clock(p_room_id uuid) returns void
language sql set search_path = '' as $$
  update public.activity_games g
  set phase = 'paused',
      remaining_ms = private.activity_time_left(g),
      running_since = null
  where g.room_id = p_room_id and g.phase = 'playing'
$$;

-- Common checks for every in-game action. p_turn_no guards against stale or
-- double clicks.
create function private.activity_action(
  p_room_id uuid, p_turn_no int, p_phases text[])
returns public.activity_games
language plpgsql set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
  v_game public.activity_games;
begin
  select * into v_game from public.activity_games where room_id = p_room_id;
  if not found or v_room.status <> 'playing'
     or v_game.turn_no <> p_turn_no
     or v_game.phase <> all (p_phases) then
    raise exception 'wrong_phase';
  end if;
  return v_game;
end $$;

create function private.activity_require_phone(p_room_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if private.activity_phone(p_room_id) is distinct from auth.uid() then
    raise exception 'wrong_role';
  end if;
end $$;

-- Starts or continues the clock and shows a word of the current mode.
create function private.activity_run(p_room_id uuid, p_word_id bigint)
returns void
language sql set search_path = '' as $$
  update public.activity_games
  set phase = 'playing', played_mode = mode, current_word_id = p_word_id,
      running_since = clock_timestamp()
  where room_id = p_room_id
$$;

-- ---------------------------------------------------------------------------
-- Settings and writing
-- ---------------------------------------------------------------------------

create function public.activity_lobby(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_room_id) then
    return null;
  end if;
  return jsonb_build_object(
    'phone_id', private.activity_phone(p_room_id),
    'max_words', coalesce(
      (select max_words from public.activity_settings where room_id = p_room_id), 3));
end $$;

-- A null argument keeps the current value. The game phone can be changed at
-- any time (a running clock is paused), the number of words until play starts.
create function public.activity_set_settings(
  p_room_id uuid, p_max_words int default null, p_phone_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room   public.rooms := private.lock_room(p_room_id);
  v_before uuid;
begin
  perform private.require_host(p_room_id);
  if v_room.game_type <> 'extreme-activity' then
    raise exception 'wrong_phase';
  end if;
  if p_max_words is not null then
    if v_room.status <> 'lobby' and not exists (
         select 1 from public.activity_games
         where room_id = p_room_id and phase = 'writing') then
      raise exception 'wrong_phase';
    end if;
    if p_max_words not between 1 and 6 then
      raise exception 'invalid_action';
    end if;
  end if;
  if p_phone_id is not null and not exists (
       select 1 from public.players
       where room_id = p_room_id and user_id = p_phone_id) then
    raise exception 'players_changed';
  end if;

  v_before := private.activity_phone(p_room_id);
  insert into public.activity_settings (room_id) values (p_room_id)
  on conflict (room_id) do nothing;
  update public.activity_settings set
    max_words = coalesce(p_max_words, max_words),
    -- Choosing the host means "follow the host".
    phone_id = case
      when p_phone_id is null then phone_id
      when p_phone_id = v_room.host_id then null
      else p_phone_id end
  where room_id = p_room_id;

  if private.activity_phone(p_room_id) <> v_before then
    perform private.activity_pause_clock(p_room_id);
  end if;
  perform private.touch(p_room_id);
end $$;

create function public.activity_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms := private.lock_room(p_room_id);
begin
  perform private.require_host(p_room_id);
  if v_room.status <> 'lobby' or v_room.game_type <> 'extreme-activity' then
    raise exception 'wrong_phase';
  end if;

  delete from public.activity_games   where room_id = p_room_id;
  delete from private.activity_points where room_id = p_room_id;
  delete from private.activity_words  where room_id = p_room_id;
  insert into public.activity_settings (room_id) values (p_room_id)
  on conflict (room_id) do nothing;
  insert into public.activity_games (room_id, phase) values (p_room_id, 'writing');

  -- Players have no fixed role, so phones may join at any time.
  update public.rooms set status = 'playing', open_to_join = true
  where id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- p_name is null for the phone's own player, otherwise the person who borrowed
-- the phone. Saved words are never handed out again before the end.
create function public.activity_submit(
  p_room_id uuid, p_words text[], p_name text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game  public.activity_games := private.activity_action(
            p_room_id, 1, array['writing']);
  v_max   int := (select max_words from public.activity_settings
                  where room_id = p_room_id);
  v_words text[];
  v_name  text;
  v_own   boolean := p_name is null;
begin
  select coalesce(array_agg(w order by i), '{}') into v_words
  from (select btrim(regexp_replace(coalesce(x, ''), '\s+', ' ', 'g')) as w, i
        from unnest(p_words) with ordinality u(x, i)) cleaned
  where w <> '';
  if cardinality(v_words) < 1
     or exists (select 1 from unnest(v_words) w where char_length(w) > 40) then
    raise exception 'invalid_word';
  end if;
  if cardinality(v_words) > v_max then
    raise exception 'too_many_words';
  end if;

  if v_own then
    select name into v_name from public.players
    where room_id = p_room_id and user_id = auth.uid();
    if exists (select 1 from private.activity_words
               where room_id = p_room_id and added_by = auth.uid() and is_own) then
      raise exception 'already_submitted';
    end if;
  else
    v_name := private.clean_name(p_name);
    if exists (select 1 from public.players
               where room_id = p_room_id and lower(name) = lower(v_name)) then
      raise exception 'name_taken';
    end if;
  end if;
  if exists (select 1 from private.activity_words
             where room_id = p_room_id and lower(author) = lower(v_name)) then
    raise exception 'name_taken';
  end if;

  insert into private.activity_words (room_id, author, added_by, is_own, word)
  select p_room_id, v_name, auth.uid(), v_own, w from unnest(v_words) w;
  perform private.touch(p_room_id);
end $$;

-- Ends the writing: the first turn of team 0 is next.
create function public.activity_play(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.activity_games := private.activity_action(
    p_room_id, 1, array['writing']);
begin
  perform private.require_host(p_room_id);
  if not exists (select 1 from private.activity_words where room_id = p_room_id) then
    raise exception 'no_words';
  end if;
  update public.activity_games set phase = 'ready' where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- ---------------------------------------------------------------------------
-- Turns (only the game phone)
-- ---------------------------------------------------------------------------

create function public.activity_begin_turn(p_room_id uuid, p_turn_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.activity_games := private.activity_action(
    p_room_id, p_turn_no, array['ready']);
begin
  perform private.activity_require_phone(p_room_id);
  update public.activity_games set remaining_ms = 60000 where room_id = p_room_id;
  perform private.activity_run(
    p_room_id, private.activity_draw(p_room_id, v_game.mode));
  perform private.touch(p_room_id);
end $$;

-- p_word_id is the word on the screen, so a double tap counts once.
create function public.activity_guessed(
  p_room_id uuid, p_turn_no int, p_word_id bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.activity_games := private.activity_action(
    p_room_id, p_turn_no, array['playing']);
  v_next bigint;
  v_left int;
begin
  perform private.activity_require_phone(p_room_id);
  if v_game.current_word_id is distinct from p_word_id then
    raise exception 'wrong_phase';
  end if;
  -- A little leeway for slow connections; later guesses go via the summary.
  if private.activity_overtime(v_game) > 1500 then
    raise exception 'time_up';
  end if;
  v_left := private.activity_time_left(v_game);

  insert into private.activity_points (room_id, turn_no, word_id, mode, team, counted)
  values (p_room_id, p_turn_no, p_word_id, v_game.mode, v_game.team, true);
  update private.activity_words set done_mode = v_game.mode where id = p_word_id;

  v_next := private.activity_draw(p_room_id, v_game.mode);
  if v_next is not null then
    update public.activity_games set current_word_id = v_next
    where room_id = p_room_id;
  else
    -- Every word is done in this mode. With time left, the same player goes
    -- on after a break; otherwise the turn is over.
    update public.activity_games set
      mode = mode + 1,
      phase = case when mode < 5 and v_left > 0 then 'new_mode' else 'summary' end,
      current_word_id = null,
      remaining_ms = v_left,
      running_since = null
    where room_id = p_room_id;
  end if;
  perform private.touch(p_room_id);
end $$;

-- Takes back the tap that ended a mode, while the break is still shown.
create function public.activity_undo_mode(p_room_id uuid, p_turn_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game  public.activity_games := private.activity_action(
            p_room_id, p_turn_no, array['new_mode']);
  v_point private.activity_points;
begin
  perform private.activity_require_phone(p_room_id);
  select * into v_point from private.activity_points
  where room_id = p_room_id and turn_no = p_turn_no and counted
  order by id desc limit 1;
  delete from private.activity_points where id = v_point.id;
  update private.activity_words set done_mode = v_point.mode - 1
  where id = v_point.word_id;
  update public.activity_games set mode = v_point.mode where room_id = p_room_id;
  perform private.activity_run(p_room_id, v_point.word_id);
  perform private.touch(p_room_id);
end $$;

create function public.activity_pause(p_room_id uuid, p_turn_no int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.activity_action(p_room_id, p_turn_no, array['playing']);
  perform private.activity_require_phone(p_room_id);
  perform private.activity_pause_clock(p_room_id);
  perform private.touch(p_room_id);
end $$;

-- After a pause, or into the next mode.
create function public.activity_resume(p_room_id uuid, p_turn_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.activity_games := private.activity_action(
    p_room_id, p_turn_no, array['paused', 'new_mode']);
begin
  perform private.activity_require_phone(p_room_id);
  perform private.activity_run(p_room_id, case
    when v_game.phase = 'paused' then v_game.current_word_id
    else private.activity_draw(p_room_id, v_game.mode) end);
  perform private.touch(p_room_id);
end $$;

create function public.activity_time_up(p_room_id uuid, p_turn_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.activity_games := private.activity_action(
    p_room_id, p_turn_no, array['playing']);
begin
  perform private.activity_require_phone(p_room_id);
  if private.activity_overtime(v_game) < -700 then
    raise exception 'time_not_up';
  end if;
  insert into private.activity_points (room_id, turn_no, word_id, mode, team, counted)
  values (p_room_id, p_turn_no, v_game.current_word_id, v_game.mode,
          v_game.team, false);
  update public.activity_games set
    phase = 'summary', current_word_id = null,
    remaining_ms = 0, running_since = null
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Correction in the summary. Only words of the last mode this turn played can
-- change; that may re-open the mode, or finish it.
create function public.activity_set_counted(
  p_room_id uuid, p_turn_no int, p_point_id bigint, p_counted boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game  public.activity_games := private.activity_action(
            p_room_id, p_turn_no, array['summary']);
  v_point private.activity_points;
begin
  perform private.activity_require_phone(p_room_id);
  update private.activity_points set counted = p_counted
  where id = p_point_id and room_id = p_room_id and turn_no = p_turn_no
    and mode = v_game.played_mode
  returning * into v_point;
  if not found then
    raise exception 'invalid_action';
  end if;
  update private.activity_words
  set done_mode = case when p_counted then v_point.mode else v_point.mode - 1 end
  where id = v_point.word_id;

  update public.activity_games set mode = case
    when private.activity_draw(p_room_id, played_mode) is null
    then played_mode + 1 else played_mode end
  where room_id = p_room_id;
  perform private.touch(p_room_id);
end $$;

-- Closes the summary: the other team is next, or the game is over.
create function public.activity_pass_on(p_room_id uuid, p_turn_no int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_game public.activity_games := private.activity_action(
    p_room_id, p_turn_no, array['summary']);
begin
  perform private.activity_require_phone(p_room_id);
  if v_game.mode > 5 then
    update public.activity_games set phase = 'game_over' where room_id = p_room_id;
    update public.rooms set status = 'finished', open_to_join = false
    where id = p_room_id;
  else
    update public.activity_games set
      phase = 'ready', turn_no = turn_no + 1, team = 1 - team,
      remaining_ms = 60000
    where room_id = p_room_id;
  end if;
  perform private.touch(p_room_id);
end $$;

-- ---------------------------------------------------------------------------
-- Players and host changes
-- ---------------------------------------------------------------------------

-- Words stay when somebody leaves. A chosen game phone falls back to the host.
create function private.activity_player_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.activity_settings set phone_id = null
  where room_id = old.room_id and phone_id = old.user_id;
  if found then
    perform private.activity_pause_clock(old.room_id);
  end if;
  return null;
end $$;

create trigger activity_player_removed
after delete on public.players
for each row execute function private.activity_player_removed();

-- When the host's phone is the game phone and the host changes, the game phone
-- changes too: stop the clock.
create function private.activity_host_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.activity_settings
                 where room_id = new.id and phone_id is not null) then
    perform private.activity_pause_clock(new.id);
  end if;
  return null;
end $$;

create trigger activity_host_changed
after update of host_id on public.rooms
for each row when (old.host_id is distinct from new.host_id)
execute function private.activity_host_changed();

-- ---------------------------------------------------------------------------
-- Snapshot
-- ---------------------------------------------------------------------------

-- One consistent view of the game. Runs with the owner's rights because the
-- words are private, so it decides itself who sees what:
--   * the open word: only the game phone, only while the clock runs
--   * the words of the finished turn: only the game phone, until it is passed on
--   * all words with their authors: everyone, once the game is over
create function public.activity_snapshot(p_room_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_game  public.activity_games;
  v_phone uuid;
  v_mine  boolean;
begin
  if not private.is_member(p_room_id) then
    return null;
  end if;
  select * into v_game from public.activity_games where room_id = p_room_id;
  if not found then
    return null;
  end if;
  v_phone := private.activity_phone(p_room_id);
  v_mine := v_phone = auth.uid();

  return jsonb_build_object(
    'game', jsonb_build_object(
      'phase', v_game.phase,
      'turn_no', v_game.turn_no,
      'mode', v_game.mode,
      'played_mode', v_game.played_mode,
      'team', v_game.team,
      'time_left_ms', private.activity_time_left(v_game)),
    'phone_id', v_phone,
    'max_words', (select max_words from public.activity_settings
                  where room_id = p_room_id),
    'words_total', (select count(*) from private.activity_words
                    where room_id = p_room_id),
    'words_left', (select count(*) from private.activity_words
                   where room_id = p_room_id and done_mode < v_game.mode),
    'turn_points', (select count(*) from private.activity_points
                    where room_id = p_room_id and turn_no = v_game.turn_no
                      and counted),
    'writers', (
      select coalesce(jsonb_agg(jsonb_build_object('name', w.author, 'count', w.n)
               order by w.first_id), '[]'::jsonb)
      from (select author, count(*) as n, min(id) as first_id
            from private.activity_words where room_id = p_room_id
            group by author) w),
    'own_submitted', exists (
      select 1 from private.activity_words
      where room_id = p_room_id and added_by = auth.uid() and is_own),
    -- Points per team and mode.
    'points', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team', s.team, 'mode', s.mode, 'points', s.n)), '[]'::jsonb)
      from (select team, mode, count(*) as n from private.activity_points
            where room_id = p_room_id and counted
            group by team, mode) s),
    'word', (
      select jsonb_build_object('id', w.id, 'text', w.word)
      from private.activity_words w
      where v_mine and v_game.phase = 'playing' and w.id = v_game.current_word_id),
    'summary', case when v_mine and v_game.phase = 'summary' then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'text', w.word, 'mode', p.mode, 'counted', p.counted)
               order by p.id), '[]'::jsonb)
      from private.activity_points p
      join private.activity_words w on w.id = p.word_id
      where p.room_id = p_room_id and p.turn_no = v_game.turn_no) end,
    'all_words', case when v_game.phase = 'game_over' then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'text', word, 'author', author) order by id), '[]'::jsonb)
      from private.activity_words where room_id = p_room_id) end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

alter table public.activity_settings enable row level security;
alter table public.activity_games    enable row level security;

revoke all on public.activity_settings, public.activity_games
  from anon, authenticated;
grant select on public.activity_settings, public.activity_games to authenticated;

create policy "members can read the settings" on public.activity_settings
  for select to authenticated using (private.is_member(room_id));
create policy "members can read the game" on public.activity_games
  for select to authenticated using (private.is_member(room_id));

revoke execute on function
  public.activity_lobby(uuid),
  public.activity_set_settings(uuid, int, uuid),
  public.activity_start(uuid),
  public.activity_submit(uuid, text[], text),
  public.activity_play(uuid),
  public.activity_begin_turn(uuid, int),
  public.activity_guessed(uuid, int, bigint),
  public.activity_undo_mode(uuid, int),
  public.activity_pause(uuid, int),
  public.activity_resume(uuid, int),
  public.activity_time_up(uuid, int),
  public.activity_set_counted(uuid, int, bigint, boolean),
  public.activity_pass_on(uuid, int),
  public.activity_snapshot(uuid)
from public, anon;

grant execute on function
  public.activity_lobby(uuid),
  public.activity_set_settings(uuid, int, uuid),
  public.activity_start(uuid),
  public.activity_submit(uuid, text[], text),
  public.activity_play(uuid),
  public.activity_begin_turn(uuid, int),
  public.activity_guessed(uuid, int, bigint),
  public.activity_undo_mode(uuid, int),
  public.activity_pause(uuid, int),
  public.activity_resume(uuid, int),
  public.activity_time_up(uuid, int),
  public.activity_set_counted(uuid, int, bigint, boolean),
  public.activity_pass_on(uuid, int),
  public.activity_snapshot(uuid)
to authenticated;
