#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $(id -u) == 0 ]] || { echo 'Run as root; this test owns only temporary deployment directories.' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
base=${SMOKE_BASE_URL:-http://127.0.0.1:8080}
[[ -n ${LUMI_CURRENT_IMAGE:-} && -n ${LUMI_PREVIOUS_IMAGE:-} ]] || { echo 'Set distinct current and previous milestone image references.' >&2; exit 1; }
[[ $LUMI_CURRENT_IMAGE != "$LUMI_PREVIOUS_IMAGE" ]] || { echo 'Rollback must use a distinct previous image.' >&2; exit 1; }
workspace=$(mktemp -d)
export COMPOSE_PROJECT_NAME="lumi-m7-smoke-$(openssl rand -hex 4)"
unset DATABASE_URL REDIS_URL JWT_SECRET ENCRYPTION_KEY ADMIN_PASSWORD LUMI_IMAGE LUMI_VERSION
cleanup() {
  code=$?
  if [[ $code != 0 && -f "$workspace/live/.env" ]]; then
    (cd -- "$workspace/live" && docker compose logs --tail 50 app postgres) || true
  fi
  for directory in "$workspace/live" "$workspace/restored"; do
    if [[ -f $directory/.env ]]; then (cd -- "$directory" && docker compose down --volumes >/dev/null) || true; fi
  done
  rm -rf -- "$workspace"
  exit "$code"
}
trap cleanup EXIT
bash "$root/deploy/docker-deploy.sh" "$workspace/live"
cd -- "$workspace/live"
sed -i 's/^ADMIN_EMAIL=.*/ADMIN_EMAIL=smoke@lumi.test/' .env
# Use image references verbatim, including registry digests.
set_image() {
  printf 'services:\n  app:\n    image: %s\n' "$1" > docker-compose.override.yml
}
set_image "$LUMI_PREVIOUS_IMAGE"
before=$(sha256sum .env)
bash "$root/deploy/docker-deploy.sh" "$workspace/live"
[[ $(sha256sum .env) == "$before" ]] || { echo 'Installer replaced credentials.' >&2; exit 1; }
docker compose up -d --wait --wait-timeout 180
curl --fail --silent "$base/readyz" >/dev/null
printf 'persisted-image-data\n' > data/app/smoke-sentinel
docker compose exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
CREATE TABLE public.m7_smoke (value text PRIMARY KEY);
INSERT INTO public.m7_smoke VALUES ('persisted-database-data');
SQL
verify_data() {
  [[ $(cat data/app/smoke-sentinel) == persisted-image-data ]]
  docker compose exec -T postgres sh -c 'exec psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT value FROM public.m7_smoke"' | grep -qx persisted-database-data
  curl --fail --silent "$base/readyz" >/dev/null
}
docker compose restart app postgres redis
docker compose up -d --wait --wait-timeout 180
verify_data
set_image "$LUMI_CURRENT_IMAGE"
docker compose up -d --wait --wait-timeout 180
verify_data
set_image "$LUMI_PREVIOUS_IMAGE"
docker compose up -d --wait --wait-timeout 180
verify_data
set_image "$LUMI_CURRENT_IMAGE"
docker compose up -d --wait --wait-timeout 180
# Persist the effective image reference into the backed up compose, not just its override.
sed -i "s|image: \${LUMI_IMAGE.*|image: $LUMI_CURRENT_IMAGE|" docker-compose.yml
BACKUP_KEEP=2 bash "$workspace/live/backup.sh"
archive=$(find "$workspace/live/backups" -maxdepth 1 -name '*.tar.gz' -print -quit)
docker compose down --volumes
bash "$workspace/live/restore.sh" "$archive" "$workspace/restored"
cd -- "$workspace/restored"
verify_data
echo 'PASS: empty-directory deployment, idempotent setup, persistent restart, M6→M7 upgrade, M7→M6 rollback, coordinated backup and fresh restore.'
