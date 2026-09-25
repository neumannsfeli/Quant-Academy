#!/bin/bash
# Roll the stack on this host to one release. Run as root by `qa-deploy <tag>`, which
# GitHub Actions calls through SSM Run Command and which the host itself calls at boot.
#   1. render /opt/qa/app.env from the stack's config, the host's secrets and SSM overrides
#   2. pull the images for <tag>
#   3. migrate and seed (forward-only migrations, idempotent seed) before the app rolls
#   4. roll web, jobs and caddy and wait for their health checks
set -euo pipefail

TAG=${1:?usage: deploy.sh <tag>}
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=/dev/null
source /opt/qa/config.env   # APP_NAME AWS_REGION REGISTRY DOMAIN MAIL_FROM SUPPORT_EMAIL SERVE_UNREVIEWED_CONTENT SSM_PATH
# shellcheck source=/dev/null
source /data/secrets.env    # AUTH_SECRET POSTGRES_PASSWORD — generated on the data volume at first boot

umask 077
{
  echo "NODE_ENV=production"
  echo "APP_URL=https://$DOMAIN"
  echo "AUTH_SECRET=$AUTH_SECRET"
  echo "AUTH_URL=https://$DOMAIN"   # Auth.js builds links from this, not from the container's own address
  echo "AUTH_TRUST_HOST=true"
  echo "POSTGRES_USER=qa"
  echo "POSTGRES_DB=quant_academy"
  echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
  echo "DATABASE_URL=postgres://qa:$POSTGRES_PASSWORD@postgres:5432/quant_academy"
  echo "DATABASE_POOL_MAX=10"
  echo "GRADER_URL=http://grader:8001"
  echo "MAIL_TRANSPORT=ses"
  echo "MAIL_FROM=$MAIL_FROM"
  echo "SUPPORT_EMAIL=$SUPPORT_EMAIL"
  echo "AWS_REGION=$AWS_REGION"
  echo "SERVE_UNREVIEWED_CONTENT=$SERVE_UNREVIEWED_CONTENT"
  # Optional settings and secrets (AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, overrides of the lines
  # above) are SSM parameters under $SSM_PATH/; the last line for a name wins.
  aws ssm get-parameters-by-path --region "$AWS_REGION" --path "$SSM_PATH" --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text |
    while IFS=$'\t' read -r name value; do [ -n "$name" ] && echo "${name##*/}=$value"; done
} > /opt/qa/app.env.new
mv /opt/qa/app.env.new /opt/qa/app.env

cat > "$HERE/compose.env" <<ENV
REGISTRY=$REGISTRY
APP_NAME=$APP_NAME
IMAGE_TAG=$TAG
DOMAIN=$DOMAIN
ACME_EMAIL=$SUPPORT_EMAIL
ENV

mkdir -p /data/postgres /data/caddy
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

qa() { docker compose --project-directory "$HERE" -f "$HERE/compose.yaml" --env-file "$HERE/compose.env" "$@"; }

echo "== pulling $TAG"
qa --profile ops pull --quiet
echo "== database"
qa up -d --wait postgres grader
qa run --rm ops migrate
qa run --rm ops seed
echo "== rolling the app"
qa up -d --wait --remove-orphans postgres grader web jobs caddy

ln -sfn "$HERE" /opt/qa/current
echo "$TAG" > /data/current-release
docker image prune -af --filter "until=168h" >/dev/null || true
ls -1dt /opt/qa/releases/*/ | tail -n +6 | xargs -r rm -rf
echo "== deployed $TAG"
qa ps --format 'table {{.Service}}\t{{.Status}}'
