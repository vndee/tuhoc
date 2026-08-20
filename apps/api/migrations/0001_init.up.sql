CREATE EXTENSION IF NOT EXISTS citext;
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL, name text NOT NULL DEFAULT '',
  pw_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE courses (
  id text PRIMARY KEY, title text NOT NULL,
  visibility text NOT NULL DEFAULT 'private', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE progress (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id text NOT NULL, chapter_id text NOT NULL, status text NOT NULL,
  done boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, course_id, chapter_id, status));
CREATE TABLE annotations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id text NOT NULL, chapter_id text NOT NULL,
  anchor jsonb NOT NULL, note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz);
CREATE INDEX idx_progress_sync ON progress (user_id, updated_at);
CREATE INDEX idx_annotations_sync ON annotations (user_id, updated_at);
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id text NOT NULL, chapter_id text NOT NULL,
  kind text NOT NULL, meta jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL);
CREATE INDEX idx_events_user_at ON events (user_id, at);
INSERT INTO courses (id, title) VALUES ('***REMOVED***', '***REMOVED***');
