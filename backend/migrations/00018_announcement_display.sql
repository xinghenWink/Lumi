-- +goose Up
ALTER TABLE announcements
    ADD COLUMN announcement_type text NOT NULL DEFAULT 'daily'
        CHECK (announcement_type IN ('system_update', 'daily')),
    ADD COLUMN display_mode text NOT NULL DEFAULT 'standalone'
        CHECK (display_mode IN ('standalone', 'history'));

UPDATE announcements SET announcement_type = 'system_update', display_mode = 'history'
WHERE github_release_tag IS NOT NULL;
