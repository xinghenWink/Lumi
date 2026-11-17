-- +goose Up
ALTER TABLE files DROP CONSTRAINT files_kind_check;
ALTER TABLE files ADD CONSTRAINT files_kind_check
    CHECK (kind IN ('upload','generated','thumbnail','avatar','edit_guide'));

ALTER TABLE image_tasks
    ADD COLUMN edit_action text NOT NULL DEFAULT '',
    ADD COLUMN edit_guide_file_id uuid,
    ADD CONSTRAINT image_tasks_edit_options_check CHECK (
        (edit_action IN ('','remove_background','resize') AND edit_guide_file_id IS NULL)
        OR (edit_action IN ('markup','erase') AND edit_guide_file_id IS NOT NULL)
    );

CREATE INDEX image_tasks_edit_guide_idx ON image_tasks(edit_guide_file_id)
    WHERE edit_guide_file_id IS NOT NULL;
