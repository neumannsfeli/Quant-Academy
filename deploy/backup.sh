#!/bin/bash
# Nightly logical backup to S3 (a qa-backup.timer on the host runs it). Kept 35 days by the
# bucket's lifecycle rule. The EBS volume is also snapshotted daily by Data Lifecycle Manager.
# Restore: aws s3 cp s3://$BUCKET/backups/<file> - | qa exec -T postgres pg_restore -U qa -d quant_academy --clean --if-exists
set -euo pipefail
# shellcheck source=/dev/null
source /opt/qa/config.env
key="backups/$(date -u +%Y-%m-%dT%H%MZ).dump"
docker compose --project-directory /opt/qa/current -f /opt/qa/current/compose.yaml --env-file /opt/qa/current/compose.env \
  exec -T postgres pg_dump -U qa -d quant_academy -Fc |
  aws s3 cp - "s3://$BUCKET/$key" --region "$AWS_REGION"
echo "backed up to s3://$BUCKET/$key"
