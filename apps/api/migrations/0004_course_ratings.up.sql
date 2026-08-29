-- course_ratings holds one row per (user, registry course): one vote each,
-- editable. user_id is part of the PRIMARY KEY, not merely a column beside
-- it, and — exactly as in 0002_course_packages — that is a SECURITY
-- decision rather than a normalisation one.
--
-- What it buys: "A's vote on course X" and "B's vote on course X" are
-- different rows BY IDENTITY, so the upsert below can only ever conflict
-- with a row that already belongs to the same user. One person's vote
-- cannot overwrite another's — not because a WHERE clause guards it, but
-- because such a collision cannot be expressed. Narrow the conflict target
-- and that property is lost silently. Repo.Put takes userID as an ARGUMENT
-- for the same reason: see repo.go.
--
-- registry_id is text with NO foreign key, and that is deliberate rather
-- than an omission. The registry is not in this database, and this API
-- deliberately never fetches it, so there is nothing here to reference.
--
-- This comment used to justify that with "apps/api product code makes no
-- outbound calls at all, a promise enforced by
-- apps/api/internal/server/no_key_transit_test.go". BOTH halves are dead as
-- of Pha 2: that test file was deleted at Task 11, and apps/api DOES make
-- outbound calls now (internal/ai to DeepSeek and Brave, internal/discuss
-- to GitHub). What is still true is the narrower fact this column depends
-- on — nothing in this API reads the registry index — and it is true
-- because no code does it, not because a gate forbids it.
--
-- The consequence is stated plainly because it shapes the layer above:
-- this column cannot prove an id is a real registry course. Two things
-- carry that weight instead, and both live in Go —
--
--   1. usecase.go validates the SHAPE of an id (a registry id is a
--      directory name in the registry repo, so it is one path segment,
--      bounded, no separators), and caps how many distinct courses one
--      account may rate, because an unbounded write endpoint with no
--      foreign key is unbounded storage growth;
--   2. handler.go NEVER ENUMERATES. There is no "list all ratings" query
--      and no route that returns one: GET /ratings answers only about the
--      ids the caller already named, which come from the public registry
--      index. That is what keeps a PRIVATE course out of every listing —
--      a vote cast on a private or file-imported course id is inert, and
--      cannot surface that id to anyone who did not already have it.
--
-- stars is smallint with CHECK (stars BETWEEN 1 AND 5). The Go layer
-- checks the same range before writing, and this is not a redundant copy
-- of a policy number in the sense 0002's comment warns about: 1..5 is not
-- a tunable limit, it is what "a star rating" MEANS. A row outside it is a
-- corrupt row that quietly falsifies every AVG computed over the table.
--
-- created_at is when the person first voted; updated_at moves when they
-- change their mind. The upsert leaves created_at alone on purpose.
CREATE TABLE course_ratings (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registry_id text NOT NULL,
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, registry_id));

-- The primary key indexes (user_id, registry_id) — the right order for
-- "this user's vote" but the wrong one for the aggregate query, which
-- groups by registry_id across all users. Without this index that query is
-- a full scan of the table on every catalog render.
CREATE INDEX idx_course_ratings_registry ON course_ratings (registry_id);
