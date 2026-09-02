-- Reverses this migration's up.sql exactly: removes 'read_my_notes' from
-- every row that has it, and restores the column DEFAULT to what migration
-- 0007 originally set.
--
-- UNLIKE 0009's down.sql, this one IS a true inverse of its own up.sql:
-- array_append followed by array_remove of the SAME element, with no
-- destructive statement (DELETE/DROP COLUMN) in between, round-trips a row
-- to its exact prior tools_enabled value. The one case this does NOT
-- restore is a learner who had 'read_my_notes' in their array BEFORE this
-- migration ran (impossible until Task 12 shipped, since nothing else ever
-- wrote that string) and who also happened to remove some OTHER tool
-- between up and down — down.sql only ever touches the one element it
-- knows about, same discipline as the migration's own up.sql.
ALTER TABLE user_agent_config
  ALTER COLUMN tools_enabled SET DEFAULT '{read_course}';

UPDATE user_agent_config
SET tools_enabled = array_remove(tools_enabled, 'read_my_notes');
