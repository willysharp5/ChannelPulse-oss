-- Persist speaker / origin / citations alongside message content so chat
-- (live overlay + post-session /chats) can ground answers in the transcript.
ALTER TABLE messages ADD COLUMN meta TEXT;
