ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('user','admin'));

-- Catalog công khai của nền tảng. KHÁC HẲN course_packages (bản riêng từng
-- người): ở đây một course chỉ có MỘT bản đang sống, không owner, ai cũng đọc.
CREATE TABLE published_courses (
  slug         text PRIMARY KEY,
  version      int  NOT NULL CHECK (version > 0),
  title        text NOT NULL,
  lang         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  manifest     jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE published_chapters (
  slug         text NOT NULL REFERENCES published_courses(slug) ON DELETE CASCADE,
  chapter_id   text NOT NULL,
  file         text NOT NULL,
  html         text NOT NULL,
  -- tên widget chương này tham chiếu, trích lúc publish, để GET chương
  -- trả kèm đúng widget mà không phải quét HTML mỗi request
  widget_names text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (slug, chapter_id));

CREATE TABLE published_assets (
  slug  text NOT NULL REFERENCES published_courses(slug) ON DELETE CASCADE,
  path  text NOT NULL,
  bytes bytea NOT NULL,
  PRIMARY KEY (slug, path));

CREATE TABLE published_widgets (
  slug text NOT NULL REFERENCES published_courses(slug) ON DELETE CASCADE,
  name text NOT NULL,
  html text NOT NULL,
  PRIMARY KEY (slug, name));

-- Nguyên zip từng bản publish: rollback là ĐỌC LẠI, không phải publish ngược.
CREATE TABLE course_versions (
  slug         text NOT NULL,
  version      int  NOT NULL CHECK (version > 0),
  zip          bytea NOT NULL,
  bytes        bigint NOT NULL CHECK (bytes >= 0),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slug, version));

-- Sổ cái thao tác admin. Không bao giờ DELETE.
--
-- actor, không chỉ who: đặc tả gốc ghi "who NULL = đường token CLI", nhưng
-- ON DELETE SET NULL cũng đưa who về NULL khi một admin THẬT bị xoá khỏi
-- users — hai chuyện khác nhau (đi bằng token CLI, hay đi bằng một tài
-- khoản nay không còn) mà cột who một mình không phân biệt được, và một sổ
-- audit tồn tại chính là để trả lời "ai đã làm việc này". actor NOT NULL
-- ghi lại tại THỜI ĐIỂM HÀNH ĐỘNG con đường nào đã xác thực request, độc
-- lập với việc who có bị SET NULL sau đó hay không:
--   'user' — request đi qua một phiên đăng nhập thật; who là uuid của
--            người đó tại lúc ghi (có thể thành NULL sau nếu người đó bị
--            xoá — actor vẫn nói "đã từng là một người dùng thật").
--   'cli'  — request xác thực bằng ADMIN_TOKEN dùng chung, không gắn với
--            tài khoản nào; who luôn NULL ngay từ đầu, không phải do
--            ON DELETE SET NULL.
CREATE TABLE admin_audit (
  id     bigserial PRIMARY KEY,
  who    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor  text NOT NULL CHECK (actor IN ('user','cli')),
  action text NOT NULL,
  target text NOT NULL,
  at     timestamptz NOT NULL DEFAULT now(),
  note   text NOT NULL DEFAULT '');
