#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $(id -u) == 0 ]] || { echo 'Run as root; this test owns only temporary deployment directories.' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
base=${SMOKE_BASE_URL:-http://127.0.0.1:8080}
[[ -n ${LUMI_CURRENT_IMAGE:-} && -n ${LUMI_PREVIOUS_IMAGE:-} ]] || { echo 'Set distinct current and previous milestone image references.' >&2; exit 1; }
[[ $LUMI_CURRENT_IMAGE != "$LUMI_PREVIOUS_IMAGE" ]] || { echo 'Rollback must use a distinct previous image.' >&2; exit 1; }
verify_rollback=${LUMI_VERIFY_ROLLBACK:-1}
[[ $verify_rollback == 0 || $verify_rollback == 1 ]] || exit 1
workspace=$(mktemp -d)
export COMPOSE_PROJECT_NAME="lumi-m7-smoke-$(openssl rand -hex 4)"
unset DATABASE_URL REDIS_URL JWT_SECRET ENCRYPTION_KEY ADMIN_PASSWORD LUMI_IMAGE LUMI_VERSION LUMI_IMAGE_REF
cleanup() {
  code=$?
  if [[ $code != 0 && -f "$workspace/live/.env" ]]; then
    (cd -- "$workspace/live" && docker compose logs --tail 50 app postgres) || true
  fi
  for directory in "$workspace/live" "$workspace/restored" "$workspace/rollback"; do
    if [[ -f $directory/.env ]]; then (cd -- "$directory" && docker compose down --volumes >/dev/null) || true; fi
  done
  rm -rf -- "$workspace"
  exit "$code"
}
trap cleanup EXIT
bash "$root/deploy/docker-deploy.sh" "$workspace/live"
cd -- "$workspace/live"
sed -i 's/^ADMIN_EMAIL=.*/ADMIN_EMAIL=smoke@lumi.test/' .env
# Keep the effective image reference in .env so each backup can restore its own version.
set_image() {
  sed -i "s|^LUMI_IMAGE_REF=.*|LUMI_IMAGE_REF=$1|" .env
}
verify_release() {
  local version=$1 commit=$2 schema=$3
  if [[ -z $version && -z $commit && -z $schema ]]; then return; fi
  curl --fail --silent "$base/api/version" | jq -e --arg version "$version" --arg commit "$commit" \
    '.version == $version and .commit == $commit' >/dev/null
  docker compose exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' | grep -qx "$schema"
SELECT version_id FROM public.goose_db_version WHERE is_applied ORDER BY id DESC LIMIT 1;
SQL
}
set_image "$LUMI_PREVIOUS_IMAGE"
before=$(sha256sum .env)
bash "$root/deploy/docker-deploy.sh" "$workspace/live"
[[ $(sha256sum .env) == "$before" ]] || { echo 'Installer replaced credentials.' >&2; exit 1; }
docker compose up -d --wait --wait-timeout 180
curl --fail --silent "$base/readyz" >/dev/null
verify_release "${LUMI_PREVIOUS_RELEASE:-}" "${LUMI_PREVIOUS_COMMIT:-}" "${LUMI_PREVIOUS_SCHEMA:-}"
password=$(sed -n 's/^ADMIN_PASSWORD=//p' .env)
login() {
  # Installer-generated smoke passwords are hexadecimal plus Aa1, so JSON quoting is unambiguous.
  printf '{"email":"smoke@lumi.test","password":"%s"}' "$password" | curl --fail --silent --show-error \
    -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:8080' -H 'X-Lumi-CSRF: 1' \
    --data-binary @- "$base/api/v1/auth/login" > "$workspace/login.json"
  token=$(sed -nE 's/.*"access_token":"([^"]+)".*/\1/p' "$workspace/login.json")
  [[ -n $token ]] || { echo 'Administrator login failed.' >&2; exit 1; }
}
login
owner=$(sed -nE 's/.*"id":"([^"]+)".*/\1/p' "$workspace/login.json")
curl --fail --silent --show-error -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:8080' -H 'X-Lumi-CSRF: 1' \
  -H "Idempotency-Key: smoke-$(openssl rand -hex 16)" \
  --data '{"action":"add","bucket":"permanent","amount":37,"note":"M7 deployment persistence"}' \
  "$base/api/v1/admin/users/$owner/credits" > "$workspace/credits.json"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMIiDoBAAJwAXNTgWk3AAAAAElFTkSuQmCC' | base64 -d > "$workspace/input.png"
curl --fail --silent --show-error -H "Authorization: Bearer $token" \
  -H 'Origin: http://127.0.0.1:8080' -H 'X-Lumi-CSRF: 1' -F "file=@$workspace/input.png" \
  "$base/api/v1/files" > "$workspace/file.json"
file_id=$(sed -nE 's/.*"id":"([^"]+)".*/\1/p' "$workspace/file.json")
[[ -n $file_id ]] || { echo 'File upload failed.' >&2; exit 1; }
download_file() {
  curl --fail --silent --show-error -H "Authorization: Bearer $token" \
    "$base/api/v1/files/$file_id/metadata" > "$workspace/metadata.json"
  file_url=$(sed 's/\\u0026/\&/g' "$workspace/metadata.json" | sed -nE 's/.*"url":"([^"]+)".*/\1/p')
  [[ $file_url == /api/v1/files/* ]] || { echo 'Signed file URL missing.' >&2; exit 1; }
  curl --fail --silent --show-error -H "Authorization: Bearer $token" "$base$file_url" > "$workspace/download.png"
}
download_file
file_hash=$(sha256sum "$workspace/download.png" | cut -d ' ' -f 1)
printf 'persisted-image-data\n' > data/app/smoke-sentinel
docker compose exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
CREATE TABLE public.m7_smoke (value text PRIMARY KEY);
INSERT INTO public.m7_smoke VALUES ('persisted-database-data');
SQL
verify_data() {
  [[ $(cat data/app/smoke-sentinel) == persisted-image-data ]]
  docker compose exec -T postgres sh -c 'exec psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT value FROM public.m7_smoke"' | grep -qx persisted-database-data
  curl --fail --silent "$base/readyz" >/dev/null
  login
  curl --fail --silent --show-error -H "Authorization: Bearer $token" "$base/api/v1/me/credits" > "$workspace/credits.json"
  grep -q '"permanent_balance":37' "$workspace/credits.json"
  download_file
  [[ $(sha256sum "$workspace/download.png" | cut -d ' ' -f 1) == "$file_hash" ]]
}
docker compose restart app postgres redis
docker compose up -d --wait --wait-timeout 180
verify_data
if [[ $verify_rollback == 0 ]]; then
  BACKUP_DIR="$workspace/pre-upgrade" bash "$workspace/live/backup.sh"
  previous_archive=$(find "$workspace/pre-upgrade" -maxdepth 1 -name '*.tar.gz' -print -quit)
fi
set_image "$LUMI_CURRENT_IMAGE"
docker compose up -d --wait --wait-timeout 180
verify_data
verify_release "${LUMI_CURRENT_RELEASE:-}" "${LUMI_CURRENT_COMMIT:-}" "${LUMI_CURRENT_SCHEMA:-}"
if [[ $verify_rollback == 1 ]]; then
  set_image "$LUMI_PREVIOUS_IMAGE"
  docker compose up -d --wait --wait-timeout 180
  verify_data
  verify_release "${LUMI_PREVIOUS_RELEASE:-}" "${LUMI_PREVIOUS_COMMIT:-}" "${LUMI_CURRENT_SCHEMA:-}"
  set_image "$LUMI_CURRENT_IMAGE"
  docker compose up -d --wait --wait-timeout 180
  verify_data
  verify_release "${LUMI_CURRENT_RELEASE:-}" "${LUMI_CURRENT_COMMIT:-}" "${LUMI_CURRENT_SCHEMA:-}"
fi
BACKUP_KEEP=2 bash "$workspace/live/backup.sh"
archive=$(find "$workspace/live/backups" -maxdepth 1 -name '*.tar.gz' -print -quit)
docker compose down --volumes
bash "$workspace/live/restore.sh" "$archive" "$workspace/restored"
cd -- "$workspace/restored"
verify_data
verify_release "${LUMI_CURRENT_RELEASE:-}" "${LUMI_CURRENT_COMMIT:-}" "${LUMI_CURRENT_SCHEMA:-}"
if [[ $verify_rollback == 0 ]]; then
  docker compose down --volumes
  bash "$workspace/live/restore.sh" "$previous_archive" "$workspace/rollback"
  cd -- "$workspace/rollback"
  verify_data
  verify_release "${LUMI_PREVIOUS_RELEASE:-}" "${LUMI_PREVIOUS_COMMIT:-}" "${LUMI_PREVIOUS_SCHEMA:-}"
fi
echo 'PASS: deployment, upgrade and fresh restore preserved administrator login, credits and original file bytes.'
