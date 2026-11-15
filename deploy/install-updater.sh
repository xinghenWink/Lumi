#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $(id -u) == 0 && $# -le 2 ]] || { echo 'Usage: sudo bash install-updater.sh [DEPLOY_DIR] [COMPOSE_PROJECT]' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
directory=$(realpath -e -- "${1:-/opt/lumi}")
project=${2:-lumi}
[[ $directory =~ ^/[a-zA-Z0-9._/-]+$ && $project =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || {
  echo 'Invalid deployment directory or Compose project name.' >&2; exit 1;
}
[[ -f $directory/.env && -f $directory/backup.sh && -f $directory/docker-compose.yml ]] || {
  echo 'Install the current Lumi deployment files first.' >&2; exit 1;
}
grep -Fq '${LUMI_IMAGE_REF:-' "$directory/docker-compose.yml" || {
  echo 'Install the current docker-compose.yml and backup.sh first.' >&2; exit 1;
}
case $(uname -m) in
  x86_64) architecture=amd64 ;;
  aarch64) architecture=arm64 ;;
  *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;;
esac
[[ -x /usr/bin/docker && -f $source_dir/lumi-updater-linux-$architecture && -f $source_dir/lumi-updater.service ]] || {
  echo 'Docker and the verified Lumi deployment archive are required.' >&2; exit 1;
}
configuration=$(mktemp /etc/.lumi-updater.XXXXXX)
trap 'rm -f -- "$configuration"' EXIT
printf 'LUMI_UPDATER_DIR=%s\nLUMI_UPDATER_PROJECT=%s\n' "$directory" "$project" > "$configuration"
if [[ -e /etc/lumi-updater ]] && ! cmp -s -- "$configuration" /etc/lumi-updater; then
  echo 'This host already has a different Lumi project enrolled.' >&2
  exit 1
fi
install -o root -g root -m 0755 "$source_dir/lumi-updater-linux-$architecture" /usr/local/bin/lumi-updater
install -o root -g root -m 0644 "$source_dir/lumi-updater.service" /etc/systemd/system/lumi-updater.service
mv -- "$configuration" /etc/lumi-updater
systemctl daemon-reload
systemctl enable --now lumi-updater.service
printf 'Lumi deployment executor enabled for %s (%s).\n' "$directory" "$project"
