-- Preset users and devices. Safe to run repeatedly (INSERT OR IGNORE).
--
-- EDIT BEFORE FIRST RUN: change display names / device names to the real ones.
-- Device UUIDs are the identity the Screen Time Agent uploads with (AGENT_DEVICE_ID).
-- They are fixed here so they stay stable across re-initialisation. Once the
-- database exists, rename via UPDATE instead of editing this file.

INSERT OR IGNORE INTO users (id, display_name) VALUES
    (1, 'User A'),
    (2, 'User B');

INSERT OR IGNORE INTO devices (id, user_id, device_name, timezone) VALUES
    ('15ba172f-e397-4155-8285-6757a75875f1', 1, 'User A MacBook', 'America/Chicago'),
    ('7145d42c-2b23-4dd3-aefc-7e81012db968', 2, 'User B MacBook', 'America/Chicago');
