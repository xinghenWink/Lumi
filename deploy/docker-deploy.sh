#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Run from a release checkout, or set LUMI_DOWNLOAD_BASE to a trusted HTTPS release directory.
target=${1:-/opt/lumi}
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p -- "$target"
target=$(cd -- "$target" && pwd)
for file in docker-compose.yml .env.example backup.sh restore.sh Caddyfile.example nginx.conf.example; do
  if [[ ! -e "$target/$file" ]]; then
    if [[ -f "$source_dir/$file" && "$source_dir" != "$target" ]]; then
      cp -- "$source_dir/$file" "$target/$file"
    elif [[ -n ${LUMI_DOWNLOAD_BASE:-} ]]; then
      [[ $LUMI_DOWNLOAD_BASE == https://* ]] || { echo 'Downloads require HTTPS.' >&2; exit 1; }
      temporary=$(mktemp "$target/.download.XXXXXX")
      curl --fail --silent --show-error --proto '=https' --tlsv1.2 "$LUMI_DOWNLOAD_BASE/$file" -o "$temporary"
      mv -- "$temporary" "$target/$file"
    else
      echo 'Run from a release checkout or set LUMI_DOWNLOAD_BASE.' >&2
      exit 1
    fi
  fi
done
command -v openssl >/dev/null
if [[ ! -e "$target/.env" ]]; then
  temporary=$(mktemp "$target/.env.XXXXXX")
  trap 'rm -f -- "$temporary"' EXIT
  while IFS= read -r line || [[ -n $line ]]; do
    case "$line" in
      JWT_SECRET=*) line="JWT_SECRET=$(openssl rand -hex 32)" ;;
      ENCRYPTION_KEY=*) line="ENCRYPTION_KEY=$(openssl rand -base64 32)" ;;
      POSTGRES_PASSWORD=*) line="POSTGRES_PASSWORD=$(openssl rand -hex 24)" ;;
      REDIS_PASSWORD=*) line="REDIS_PASSWORD=$(openssl rand -hex 24)" ;;
      ADMIN_PASSWORD=*) line="ADMIN_PASSWORD=$(openssl rand -hex 24)Aa1" ;;
    esac
    printf '%s\n' "$line" >> "$temporary"
  done < "$target/.env.example"
  # A hard link publishes the complete file atomically without overwriting another invocation.
  ln -- "$temporary" "$target/.env"
fi
mkdir -p -- "$target/data/app"
if [[ $(id -u) == 0 ]]; then
  chown 10001:10001 -- "$target/data/app"
else
  echo "Before starting: sudo chown 10001:10001 '$target/data/app'"
fi
printf 'Configuration ready in %s; existing files were preserved.\n' "$target"
echo 'Set ADMIN_EMAIL, PUBLIC_BASE_URL and COOKIE_SECURE in .env. Passwords are stored there, never printed.'
printf 'cd %q && docker compose pull && docker compose up -d --wait\n' "$target"
