-- Defence in depth for the "private" schema.
--
-- The core migration meant to stop new functions there from being executable by
-- everyone, but Postgres ignores that: a per-schema "alter default privileges"
-- can't take away the global default for PUBLIC. So every function in "private"
-- was executable by any signed-in user. That couldn't be used, because the API
-- doesn't expose the schema; this removes the right anyway.
--
-- A later migration that adds functions to "private" must repeat the revoke.
-- supabase/tests/permissions.test.ts fails otherwise.

revoke execute on all functions in schema private from public, anon, authenticated;

-- The only one clients need: the Row Level Security policies call it. Everything
-- else is called from "security definer" functions, which run as their owner.
grant execute on function private.is_member(uuid) to authenticated;
