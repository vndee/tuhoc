-- Reverse creation order from 0005_published_catalog.up.sql. admin_audit and
-- course_versions carry no incoming references so either could drop first,
-- but published_widgets/published_assets/published_chapters MUST drop
-- before published_courses -- each holds a REFERENCES published_courses(slug)
-- FOREIGN KEY, and Postgres refuses to drop a table another table still
-- references.
DROP TABLE IF EXISTS admin_audit;
DROP TABLE IF EXISTS course_versions;
DROP TABLE IF EXISTS published_widgets;
DROP TABLE IF EXISTS published_assets;
DROP TABLE IF EXISTS published_chapters;
DROP TABLE IF EXISTS published_courses;
ALTER TABLE users DROP COLUMN role;
