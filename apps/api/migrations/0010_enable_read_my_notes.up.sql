-- Task 12 (Pha 3): read_my_notes joins the tools a learner gets by default.
--
-- defaultAgentConfig() (internal/ai/credits.go) only ever runs for a SELECT
-- that finds NO row in user_agent_config — it is a Go-side stand-in for
-- column defaults, because Postgres applies a column DEFAULT on INSERT
-- only, never retroactively. So changing that Go function (as Task 12
-- does, in the same commit as this migration) makes "default on" true for
-- every NEW account, and does nothing at all for the rows that already
-- exist: each of those already has its own tools_enabled array, and the
-- Go function is never consulted for a row that is actually there.
--
-- The two statements below are what makes "default on" also true for every
-- EXISTING account, matching the column default this table has always
-- carried (migration 0007) forward to include the new tool.

-- The column DEFAULT itself, so a future INSERT that omits tools_enabled
-- (there is none today — SaveAgentConfig, credits.go, always supplies it
-- explicitly — but the column default documents the same "default on"
-- decision at the schema level, the way it already did for read_course)
-- stays in sync with defaultAgentConfig()'s Go-side mirror of it.
ALTER TABLE user_agent_config
  ALTER COLUMN tools_enabled SET DEFAULT '{read_course,read_my_notes}';

-- IDEMPOTENT BY CONSTRUCTION: the WHERE clause only touches a row that does
-- NOT already carry 'read_my_notes', so running this migration a second
-- time (a migrate-up retried after a partial failure, or a manual re-run)
-- appends the tool at most once per row, never a duplicate entry that would
-- send DeepSeek the same function twice in a Request.Tools array
-- (enabledTools, agent.go, walks tools_enabled and appends one Tool per
-- name — see AgentConfig's own doc comment on why SaveAgentConfig
-- deduplicates on every write).
UPDATE user_agent_config
SET tools_enabled = array_append(tools_enabled, 'read_my_notes')
WHERE NOT ('read_my_notes' = ANY(tools_enabled));
