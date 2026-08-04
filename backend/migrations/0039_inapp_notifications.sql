-- 0039: In-app notifications + cycle count soft-freeze warnings
CREATE TABLE IF NOT EXISTS app_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT DEFAULT '',
    notif_type TEXT DEFAULT 'info',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_app_notifications_user_read ON app_notifications(user_id, is_read);
