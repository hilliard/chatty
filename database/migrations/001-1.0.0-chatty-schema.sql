-- 001-1.0.0-chatty-schema.sql

-- 1. Human-Centric Core
CREATE TABLE humans (
    id TEXT PRIMARY KEY, -- nanoid
    first_name TEXT,
    last_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Temporal Email History
CREATE TABLE email_history (
    id TEXT PRIMARY KEY, -- nanoid
    human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ, -- NULL indicates current active email
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_current_email ON email_history(human_id) WHERE effective_to IS NULL;

-- 3. Chat Persona (The App-Specific Role)
CREATE TABLE chat_profiles (
    human_id TEXT PRIMARY KEY REFERENCES humans(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL, -- Hex color for avatar
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Rooms
CREATE TABLE rooms (
    id TEXT PRIMARY KEY, -- slug (e.g., 'lobby')
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT REFERENCES humans(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Messages
CREATE TABLE messages (
    id TEXT PRIMARY KEY, -- nanoid
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    human_id TEXT REFERENCES humans(id) ON DELETE SET NULL, -- NULL for system events
    content TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('message', 'join', 'leave', 'rename')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX messages_room_time_idx ON messages(room_id, created_at);

-- 6. Notifications
CREATE TABLE notifications (
    id TEXT PRIMARY KEY, -- nanoid
    human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
    from_human_id TEXT REFERENCES humans(id) ON DELETE SET NULL,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    preview TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX notifications_user_idx ON notifications(human_id, read, created_at);

-- 7. Seed System User and Lobby
INSERT INTO humans (id, first_name) VALUES ('system', 'System');
INSERT INTO chat_profiles (human_id, nickname, color) VALUES ('system', 'System', '#666666');
INSERT INTO rooms (id, name, description, created_by) VALUES ('lobby', 'Lobby', 'The default room', 'system');

