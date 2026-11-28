-- Two fixes for "Der wahre Walter":
--   * "ß" counts as "ss", so that "Fussball" and "Fußball" are the same answer.
--   * The Sphinx only goes empty-handed for being too obvious if at least two
--     votes found the truth. When the host goes on without offline players, a
--     single vote used to be "everyone".
--
-- Works with the version of the app that is already deployed.
-- "create or replace" keeps the rights: clients still can't run these.

-- Answers match if they differ only in capitals, punctuation, spaces, and "ß"
-- for "ss".
create or replace function private.walter_normalize(p_text text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(
    btrim(regexp_replace(
      regexp_replace(
        replace(replace(lower(normalize(p_text, nfc)), 'ß', 'ss'), 'ẞ', 'ss'),
        '[''’`´]', '', 'g'),
      '(\s|[!"#$%&()*+,./:;<=>?@\[\]\\^_{|}~«»‹›„“”‚‘…–—¡¿-])+', ' ', 'g')),
    ''), btrim(p_text))
$$;

-- As before, except for when the Sphinx gets nothing.
create or replace function private.walter_award(p_room_id uuid) returns void
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

  -- If everyone finds the truth, the Sphinx gets nothing (4+ players only, and
  -- not on the strength of a single vote).
  v_foul := cardinality(v_game.player_ids) >= 4
            and v_voters >= 2 and v_correct = v_voters;

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
