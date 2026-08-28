-- Recreates course_packages exactly as 0002_course_packages.up.sql defined
-- it — comments included, verbatim — so a down migration restores the
-- SCHEMA this table once had, not a guess at what it should look like now.
-- It restores the shape only: any rows this table held before 0006's up
-- migration dropped it are gone and cannot come back from a schema
-- migration, which is why this reversal exists for symmetry and local
-- rollback testing, not as an operational undo of real data loss.
--
-- course_packages stores one row per (owner, course, version): every user
-- holds their own copy of every package they import. owner_id is part of
-- the PRIMARY KEY, not merely a column beside it, and that is a security
-- decision rather than a normalisation one -- it makes "user A's package"
-- and "user B's package" different rows by identity, so there is no query,
-- upsert conflict, or delete that can reach across accounts even if a
-- WHERE clause is one day forgotten. The cost is duplicated storage
-- (~0.4 MB per compressed package); revisit if a single package ever
-- exceeds ~10 MB.
--
-- bytes is the UNCOMPRESSED total of the package contents, never
-- length(blob): the ingest ceiling is applied to this number precisely
-- because a zip bomb is tiny compressed and enormous expanded. The
-- ceiling itself is deliberately NOT here -- it belongs at the ingest
-- boundary where the number is produced, and a second copy of it in the
-- schema is a second copy to drift. CHECK (bytes >= 0) is a different
-- thing: it duplicates no policy number, it only says the column holds a
-- size. A review measured -1 being stored happily; one negative row
-- poisons every SUM(bytes) a later task computes over a library. Zero is
-- allowed on purpose (an empty package is odd, not corrupt).
--
-- The pre-existing courses table from 0001_init is deliberately left
-- untouched.
CREATE TABLE course_packages (
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id  text NOT NULL,
  version    text NOT NULL,
  tier       text NOT NULL CHECK (tier IN ('content','interactive')),
  lang       text NOT NULL,
  title      text NOT NULL,
  manifest   jsonb NOT NULL,
  blob       bytea NOT NULL,
  bytes      bigint NOT NULL CHECK (bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, course_id, version));
CREATE INDEX idx_course_packages_owner ON course_packages (owner_id, course_id);
