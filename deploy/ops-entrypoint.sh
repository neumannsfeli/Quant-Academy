#!/bin/sh
# Entrypoint of the ops image: one-off database tasks and the jobs scheduler.
set -eu
cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  migrate) cd /repo/packages/db && exec node_modules/.bin/tsx src/migrate.ts ;;
  seed)    cd /repo/packages/db && exec node_modules/.bin/tsx src/seed.ts ;;
  jobs)    cd /repo/apps/jobs && exec node_modules/.bin/tsx src/local.ts "$@" ;;
  *) echo "usage: migrate | seed | jobs schedule | jobs once <job> [--force]" >&2; exit 2 ;;
esac
