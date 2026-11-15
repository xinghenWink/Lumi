#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $(id -u) == 0 && $# == 2 ]] || { echo 'Usage: managed-deployment-smoke.sh SOURCE_IMAGE TARGET_IMAGE' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
fixture=$(mktemp -d /var/lib/lumi-managed-smoke.XXXXXX)
project=lumi-managed-$(openssl rand -hex 5)
registry_id=
source_version=v99.1.0
target_version=v99.2.0
cleanup() {
  code=$?
  if [[ -f $fixture/live/.env ]]; then
    (cd -- "$fixture/live" && COMPOSE_PROJECT_NAME=$project docker compose down --volumes --remove-orphans >/dev/null) || true
  fi
  if [[ -f $fixture/restored/.env ]]; then
    (cd -- "$fixture/restored" && COMPOSE_PROJECT_NAME=$project-restore docker compose down --volumes --remove-orphans >/dev/null) || true
  fi
  if [[ -n $registry_id ]]; then docker stop "$registry_id" >/dev/null || true; fi
  if [[ $fixture == /var/lib/lumi-managed-smoke.* ]]; then rm -rf -- "$fixture"; fi
  exit "$code"
}
trap cleanup EXIT
registry_id=$(docker run --rm -d -p 127.0.0.1::5000 registry:2.8.3)
registry=$(docker port "$registry_id" 5000/tcp)
curl --fail --silent --retry 10 --retry-connrefused --retry-delay 1 "http://$registry/v2/" >/dev/null
image=$registry/lumi
docker tag "$1" "$image:$source_version"
docker tag "$2" "$image:$target_version"
docker push "$image:$source_version"
docker push "$image:$target_version"
docker pull "$image:$source_version"
docker pull "$image:$target_version"
(cd -- "$root/backend" && go test -tags=integration -c -o "$fixture/managed.test" ./cmd/lumi-updater)

bash "$root/deploy/docker-deploy.sh" "$fixture/live"
cd -- "$fixture/live"
{
  printf 'ADMIN_EMAIL=managed-smoke@lumi.test\n'
  printf 'LUMI_IMAGE=%s\nLUMI_VERSION=%s\n' "$image" "$source_version"
} >> .env
password=$(sed -n 's/^ADMIN_PASSWORD=//p' .env)
COMPOSE_PROJECT_NAME=$project docker compose up -d --wait --wait-timeout 180
LUMI_MANAGED_SMOKE_DIR=$fixture/live LUMI_MANAGED_SMOKE_PROJECT=$project LUMI_MANAGED_SMOKE_IMAGE=$image \
  LUMI_MANAGED_SMOKE_TARGET=$target_version LUMI_MANAGED_SMOKE_PASSWORD=$password \
  "$fixture/managed.test" -test.run '^TestManagedComposeSwitch$' -test.v
archive=$(find backups -name 'lumi-deployment-*.tar.gz' -printf '%T@ %p\n' | sort -n | head -n 1 | cut -d ' ' -f 2-)
COMPOSE_PROJECT_NAME=$project docker compose stop app
COMPOSE_PROJECT_NAME=$project-restore bash restore.sh "$archive" "$fixture/restored"
cd -- "$fixture/restored"
restored_state=$(COMPOSE_PROJECT_NAME=$project-restore docker compose exec -T postgres sh -c 'exec psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT stage FROM deployment_jobs WHERE reason='DEPLOYMENT_SNAPSHOT_RESTORED';
SQL
)
[[ $restored_state == failed ]] || { echo 'The restored snapshot did not release its interrupted deployment.' >&2; exit 1; }
curl --fail --silent --show-error http://127.0.0.1:8080/ > /dev/null
echo 'PASS: managed updates, managed rollback, and isolated restore of an active-task backup.'
