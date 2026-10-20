DROP TABLE IF EXISTS folder_imports;
ALTER TABLE folders DROP COLUMN IF EXISTS imported_from;
ALTER TABLE folders DROP COLUMN IF EXISTS shared_at;
ALTER TABLE folders DROP COLUMN IF EXISTS share_token;
