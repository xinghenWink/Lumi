#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $# == 5 ]] || { echo 'Usage: verify-release-transitions.sh TAG DIGEST COMMIT ARCH OUTPUT' >&2; exit 1; }
tag=$1
digest=$2
commit=$3
architecture=$4
output=$5
stable='^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
[[ $tag =~ $stable && $digest =~ ^sha256:[a-f0-9]{64}$ && $commit =~ ^[a-f0-9]{40}$ &&
   $architecture =~ ^(amd64|arm64)$ ]] || { echo 'Invalid release metadata.' >&2; exit 1; }
image=ghcr.io/xinghenwink/lumi
repo=xinghenWink/Lumi
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$root"
schema=$(find backend/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | cut -d _ -f 1 | sort -n | tail -1)
[[ $schema =~ ^[0-9]{5}$ ]] || { echo 'Cannot derive database schema version.' >&2; exit 1; }
schema=$((10#$schema))
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
: > "$temporary/upgrades"
: > "$temporary/rollbacks"

jq -ce --arg tag "$tag" --arg stable "$stable" '
  (.[$tag] // []) |
  if type != "array" or length > 8 then error("invalid transition list") else . end |
  if all(.[];
    type == "object" and (keys == ["rollback","version"]) and
    (.version | type == "string" and test($stable)) and (.rollback | type == "boolean")
  ) then . else error("invalid approved transition") end |
  if ([.[].version] | unique | length) == length then . else error("duplicate transition") end
' deploy/release-compatibility.json > "$temporary/approved"

while IFS= read -r entry; do
  previous=$(jq -r .version <<< "$entry")
  rollback=$(jq -r .rollback <<< "$entry")
  [[ $previous != "$tag" && $(printf '%s\n' "$previous" "$tag" | sort -V | head -n 1) == "$previous" ]] || {
    echo 'Approved sources must be older formal releases.' >&2; exit 1;
  }
  gh api "repos/$repo/releases/tags/$previous" > "$temporary/github"
  expected=$(jq -er --arg tag "$previous" '
    select(.tag_name==$tag and (.draft == false) and (.prerelease == false)) |
    .assets[] | select(.name=="lumi-release.json") | .digest |
    select(type == "string" and test("^sha256:[a-f0-9]{64}$"))
  ' "$temporary/github")
  gh release download "$previous" --repo "$repo" --pattern lumi-release.json --output "$temporary/source" --clobber
  actual=$(sha256sum "$temporary/source")
  [[ $expected == "sha256:${actual%% *}" ]] || { echo 'Prior release manifest identity mismatch.' >&2; exit 1; }
  jq -e --arg tag "$previous" --arg image "$image" --arg platform "linux/$architecture" '
    .format == 1 and .version == $tag and .image == $image and
    (.digest | test("^sha256:[a-f0-9]{64}$")) and (.commit | test("^[a-f0-9]{40}$")) and
    (.platforms | index($platform) != null) and (.schema | type == "number" and . >= 1 and floor == .)
  ' "$temporary/source" >/dev/null
  source_digest=$(jq -r .digest "$temporary/source")
  source_schema=$(jq -r .schema "$temporary/source")
  source_commit=$(jq -r .commit "$temporary/source")
  docker pull --platform "linux/$architecture" "$image@$source_digest"
  verify_rollback=0
  if [[ $rollback == true ]]; then verify_rollback=1; fi
  sudo env LUMI_PREVIOUS_IMAGE="$image@$source_digest" LUMI_CURRENT_IMAGE="$image@$digest" \
    LUMI_VERIFY_ROLLBACK="$verify_rollback" LUMI_PREVIOUS_SCHEMA="$source_schema" LUMI_CURRENT_SCHEMA="$schema" \
    LUMI_PREVIOUS_RELEASE="$previous" LUMI_CURRENT_RELEASE="$tag" \
    LUMI_PREVIOUS_COMMIT="$source_commit" LUMI_CURRENT_COMMIT="$commit" bash scripts/deploy-smoke.sh
  jq -nc --arg version "$previous" --arg digest "$source_digest" --argjson schema "$source_schema" \
    '{version:$version,digest:$digest,schema:$schema}' >> "$temporary/upgrades"
  if [[ $rollback == true ]]; then
    # The same job verifies re-upgrading with the already advanced database.
    jq -nc --arg version "$previous" --arg digest "$source_digest" --argjson schema "$schema" \
      '{version:$version,digest:$digest,schema:$schema}' | tee -a "$temporary/rollbacks" >> "$temporary/upgrades"
  fi
done < <(jq -c '.[]' "$temporary/approved")

jq -nS --arg version "$tag" --arg digest "$digest" --arg commit "$commit" --arg image "$image" --argjson schema "$schema" \
  --slurpfile upgrade "$temporary/upgrades" --slurpfile rollback "$temporary/rollbacks" '
  {format:1,version:$version,image:$image,commit:$commit,digest:$digest,platforms:["linux/amd64","linux/arm64"],
    schema:$schema,upgrade_from:($upgrade | unique),rollback_to:($rollback | unique)}
' > "$output"
