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
-- Không seed course nào. Nền tảng không đi kèm nội dung: một course là gói rời
-- người đọc tự import (docs/publishing.md §4). Dòng seed cũ ở đây nướng id +
-- tiêu đề một giáo trình RIÊNG TƯ vào mọi database của mọi người tự chạy bản
-- riêng — xem 0003_drop_seed_course, migration dọn nó khỏi các database ĐÃ chạy
-- 0001 trước khi dòng ấy bị bỏ đi.
