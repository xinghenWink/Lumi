#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $(id -u) == 0 && $# == 2 ]] || { echo 'Usage: sudo bash restore.sh TRUSTED_BACKUP.tar.gz EMPTY_DIRECTORY' >&2; exit 1; }
archive=$(realpath -- "$1")
[[ -f $archive && -f $archive.sha256 ]] || { echo 'Archive and SHA256 sidecar required.' >&2; exit 1; }
# Verify by digest, allowing the backup to have been moved to another machine.
expected=$(cut -d ' ' -f 1 -- "$archive.sha256")
[[ $expected =~ ^[a-f0-9]{64}$ && $(sha256sum "$archive" | cut -d ' ' -f 1) == "$expected" ]] || { echo 'Backup checksum mismatch.' >&2; exit 1; }
mkdir -p -- "$2"
target=$(cd -- "$2" && pwd)
[[ -z $(find "$target" -mindepth 1 -maxdepth 1 -print -quit) ]] || { echo 'Restore target must be empty; existing deployments are never overwritten.' >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
# Reject links, device files and path traversal before extraction.
while IFS= read -r entry; do
  [[ $entry != /* && /$entry/ != *'/../'* && $entry =~ ^(app(/.*)?|database.dump|\.env|docker-compose.yml|images.json|SHA256SUMS)$ ]] || { echo 'Unsafe archive path.' >&2; exit 1; }
done < <(tar -tzf "$archive")
tar -tvzf "$archive" > "$stage/listing"
if grep -vE '^[-d]' "$stage/listing" > /dev/null; then echo 'Archive links/devices are forbidden.' >&2; exit 1; fi
tar -xzf "$archive" --no-same-owner -C "$stage"
(cd -- "$stage" && sha256sum --check --status SHA256SUMS)
if [[ -n ${DATABASE_URL:-}${REDIS_URL:-} ]] || grep -qE '^(DATABASE_URL|REDIS_URL)=.+' "$stage/.env"; then
  echo 'External database/cache overrides are not supported by automated restore.' >&2
  exit 1
fi
cp -- "$stage/.env" "$stage/docker-compose.yml" "$target/"
mkdir -p -- "$target/data"
cp -a -- "$stage/app" "$target/data/app"
chown -R 10001:10001 -- "$target/data/app"
cd -- "$target"
docker compose up -d --wait postgres redis
# No app has started: restore into a fresh database before automatic migrations can run.
docker compose exec -T postgres sh -c 'exec pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$stage/database.dump"
# A restored isolated instance has no live executor or operation journal.
docker compose exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
DO $restore_deployment$
BEGIN
    IF to_regclass('deployment_jobs') IS NOT NULL THEN
        DELETE FROM deployment_executor;
        WITH interrupted AS (
            UPDATE deployment_jobs
            SET stage = 'failed', reason = 'DEPLOYMENT_SNAPSHOT_RESTORED',
                updated_at = now(), finished_at = now()
            WHERE finished_at IS NULL OR stage = 'recovery_required'
            RETURNING id, actor_id, actor_ip
        )
        INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, "after", ip)
        SELECT gen_random_uuid(), actor_id, 'deployment.snapshot_restored',
               'deployment_job', id, '{"stage":"failed"}'::jsonb, actor_ip FROM interrupted;
    END IF;
END
$restore_deployment$;
SQL
docker compose up -d --wait
echo 'Restore complete. Verify readiness, login, credits and image downloads before switching traffic.'
