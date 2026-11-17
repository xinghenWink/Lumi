-- +goose Up
CREATE INDEX image_tasks_conversation_status_idx
    ON image_tasks(conversation_id,status,created_at DESC,id DESC);
