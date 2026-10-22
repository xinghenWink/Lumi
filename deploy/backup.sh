#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $(id -u) == 0 ]] || { echo 'Run as root to preserve image ownership.' >&2; exit 1; }
directory=$(cd -- "${DEPLOY_DIR:-$(dirname -- "${BASH_SOURCE[0]}")}" && pwd)
cd -- "$directory"
[[ -f .env && -f docker-compose.yml && -d data/app ]] || { echo 'Deployment is incomplete.' >&2; exit 1; }
if [[ -n ${DATABASE_URL:-}${REDIS_URL:-} ]] || grep -qE '^(DATABASE_URL|REDIS_URL)=.+' .env; then
  echo 'This backup supports bundled PostgreSQL/Redis only; external services need coordinated operator backups.' >&2
  exit 1
fi
destination=${BACKUP_DIR:-$directory/backups}
mkdir -p -- "$destination"
destination=$(cd -- "$destination" && pwd)
[[ $destination != "$directory/data" && $destination != "$directory/data/"* ]] || { echo 'Backup must be outside data.' >&2; exit 1; }
keep=${BACKUP_KEEP:-7}
[[ $keep =~ ^[1-9][0-9]*$ ]] || { echo 'BACKUP_KEEP must be positive.' >&2; exit 1; }
exec 9>"$directory/.backup.lock"
flock -n 9 || { echo 'Another backup is active.' >&2; exit 1; }
stage=$(mktemp -d "$destination/.lumi-backup.XXXXXX")
archive="$destination/lumi-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4).tar.gz"
restart=false
cleanup() {
  code=$?
  if $restart; then docker compose start app >/dev/null || code=1; fi
  rm -rf -- "$stage"
  exit "$code"
}
trap cleanup EXIT
# Quiesce the only application instance so PG metadata and image files share a recovery point.
if [[ -n $(docker compose ps --status running -q app) ]]; then
  restart=true
  docker compose stop -t 65 app >/dev/null
fi
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$stage/database.dump"
cp -a -- data/app "$stage/app"
cp -- .env docker-compose.yml "$stage/"
docker compose images --format json > "$stage/images.json"
(cd -- "$stage" && sha256sum database.dump .env docker-compose.yml images.json > SHA256SUMS)
tar -C "$stage" -czf "$archive.partial" -- database.dump app .env docker-compose.yml images.json SHA256SUMS
mv -- "$archive.partial" "$archive"
sha256sum "$archive" > "$archive.sha256"
# Rotate only our completed archives, after publishing the new backup successfully.
mapfile -t backups < <(find "$destination" -maxdepth 1 -type f -name 'lumi-????????T??????Z-????????.tar.gz' -printf '%f\n' | sort -r)
for ((index=keep; index<${#backups[@]}; index++)); do
  rm -f -- "$destination/${backups[index]}" "$destination/${backups[index]}.sha256"
done
printf 'Backup created: %s (contains secrets; encrypt before off-host transfer).\n' "$archive"
