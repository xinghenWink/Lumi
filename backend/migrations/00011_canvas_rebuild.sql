-- +goose Up
-- Stop the old application before migrating. Keep image task and credit rows so
-- the image worker can settle canceled work and the ledger remains auditable.
UPDATE conversations c
SET deleted_at = now(), version = c.version + 1
FROM canvases b
WHERE c.id = b.conversation_id AND c.user_id = b.user_id
  AND c.type = 'canvas' AND c.deleted_at IS NULL;

UPDATE image_tasks t
SET cancel_requested = true, version = t.version + 1, updated_at = now()
FROM canvases b
WHERE t.conversation_id = b.conversation_id AND t.user_id = b.user_id
  AND t.status IN ('queued', 'running') AND NOT t.cancel_requested;

UPDATE files f
SET deleted_at = now()
FROM image_tasks t JOIN canvases b
  ON t.conversation_id = b.conversation_id AND t.user_id = b.user_id
WHERE f.task_id = t.id AND f.user_id = b.user_id AND f.kind = 'generated'
  AND f.deleted_at IS NULL;

DELETE FROM canvases;

ALTER TABLE canvases ADD CONSTRAINT canvas_document_schema_check
    CHECK (document @> '{"schema":2}'::jsonb);
