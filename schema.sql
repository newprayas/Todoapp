DROP TABLE IF EXISTS todos;

CREATE TABLE todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    duration_hours INTEGER,
    duration_minutes INTEGER,
    focused_time INTEGER NOT NULL DEFAULT 0
);