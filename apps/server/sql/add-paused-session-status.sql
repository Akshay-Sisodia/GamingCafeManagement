-- Run once on existing databases before deploying session pause support.
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'paused';
