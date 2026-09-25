# Deploying Quant Academy to AWS

This is the launch-size deployment: **one small Graviton instance runs everything**, at roughly
**$15 a month**. The tech spec's Option A (§14: App Runner, RDS, Lambda, a NAT instance) is the
next step up, at $50–65 a month. The application code is the same for both. Only where the
containers run changes.

```
            DNS A record ──► Elastic IP
                              │
   ┌──────────────────────────┼─────────────────────── EC2 t4g.micro (Amazon Linux 2023) ─┐
   │                        caddy :80/:443  (Let's Encrypt TLS, HTTP/3)                   │
   │                          │                                                           │
   │                        web :3000 ──► grader :8001  (FastAPI + SymPy)                 │
   │                          │                                                           │
   │   jobs (scheduler) ──► postgres :5432 ──► /data  (separate encrypted EBS volume)     │
   └──────────────────────────────────────────────────────────────────────────────────────┘
        │ SES (email)   │ ECR (images)   │ S3 (releases, nightly pg_dump)   │ CloudWatch Logs
        DLM: daily snapshot of /data, 7 kept
```

| File | What it is |
| --- | --- |
| `infra/quant-academy.yaml` | The CloudFormation template: network, instance, data volume, SES identity, ECR, S3, the GitHub deploy role, alarms and budget |
| `Dockerfile` | `web` (Next.js standalone) and `ops` (migrate, seed, jobs) images |
| `apps/grader/Dockerfile` | The grader image |
| `deploy/compose.yaml`, `deploy/Caddyfile` | The stack the instance runs |
| `deploy/deploy.sh` | Rolls the instance to one release: writes the env file, pulls, migrates, seeds, restarts, health-checks |
| `deploy/backup.sh` | The nightly `pg_dump` to S3 |
| `.github/workflows/deploy.yml` | On every merge to `main`: builds the images, pushes them to ECR, runs `qa-deploy` over SSM |
| `.github/workflows/ci.yml` | Runs on pull requests: typecheck, all tests, grader tests, image build |

## Monthly cost (eu-west-2, on-demand, approximate)

| Line | t4g.micro | t4g.small |
| --- | --- | --- |
| EC2 instance | $7 | $14 |
| EBS: 20 GB root + 10 GB data (gp3) | $3 | $3 |
| Public IPv4 address | $3.65 | $3.65 |
| Snapshots, S3 backups, ECR images, CloudWatch Logs | ~$1.50 | ~$1.50 |
| SES ($0.10 per 1,000 emails) | < $0.10 | < $0.10 |
| Route 53 hosted zone (only if you use one) | $0.50 | $0.50 |
| **Total** | **≈ $15** | **≈ $22** |

The Option A design costs about $50–65 a month. This one is cheaper for three reasons:

- **Postgres runs on the instance, not on RDS.** That saves about $16.
- **The instance has a public IP.** It needs no App Runner (about $15) and no NAT instance or gateway ($4–32).
- **The grader and jobs run in containers** instead of on Lambda.

**Ways to spend even less:**

- **Commit to a year.** A 1-year Compute Savings Plan with no upfront payment takes about 30% off the instance.
- **Use free-tier credits.** Check whether the account's AWS Free Tier credits cover the first months.
- **Keep the default size.** The stack idles at about 330 MB and peaks near 500 MB during a deploy (measured), so t4g.micro is enough at launch. Move up when the CPU-credit alarm fires.

**What you give up compared with Option A:**

- **Everything runs in one Availability Zone.** If that zone fails, the site is down until you restore from a snapshot.
- **Deploys cause a few seconds of 502s** while the web container restarts.
- **Postgres is yours to look after.** Backups and snapshots are set up, but upgrades are manual.

Move to Option A or B (tech spec §14–16) when any of these happens:

- revenue depends on uptime;
- CPU-credit alarms fire regularly;
- a second engineer joins.

The containers and environment variables stay the same. You point `DATABASE_URL` at RDS and run
the images on App Runner or ECS.

## One-time setup

**1. Create the stack.** Use the CloudFormation console ("Create stack" → upload
`infra/quant-academy.yaml`), or the CLI:

```bash
aws cloudformation deploy --region eu-west-2 --stack-name quant-academy \
  --template-file infra/quant-academy.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides DomainName=quantacademy.co.uk AlertEmail=you@example.com \
                        HostedZoneId=Z0123456789ABC   # optional, see step 2
```

If this AWS account already has the GitHub identity provider
(`token.actions.githubusercontent.com`), add `CreateGitHubOidcProvider=false`.

**2. Set up DNS.**
- **Route 53:** pass `HostedZoneId` and the stack creates the site's A record and SES's three DKIM records.
- **Any other DNS provider:** create an A record for the domain pointing to the `PublicIp` output, and the three CNAMEs listed in the `DkimRecords` output.

**3. Ask for SES production access.** Do this now: it takes a day or two. In the SES console,
open *Account dashboard* → *Request production access*. Until AWS grants it, SES only delivers
to addresses you've verified in the console. That's enough for testing, but not for sign-ups.

**4. Connect GitHub.** In the app repository's *Settings → Secrets and variables → Actions*, add:
- Variables:
  - `AWS_REGION`: e.g. `eu-west-2`
  - `STACK_NAME`: e.g. `quant-academy`
  - `AWS_DEPLOY_ROLE_ARN`: the stack's `DeployRoleArn` output
- Secret: `CURRICULUM_TOKEN`. This is a fine-grained personal access token with read-only
  *Contents* access to `Quant-Academy-Curriculum-`. The build and CI need it to fetch the content
  pack, because that repository is private.

**5. Deploy.** Merge to `main`, or run the *deploy* workflow by hand. The first deploy migrates
the database and seeds the content. You can watch the run in the Actions tab.

**6. Make yourself an admin.** Sign in on the site once, then open a shell on the instance
(the `Shell` stack output) and run:

```bash
sudo qa exec postgres psql -U qa -d quant_academy -c "update users set role='admin' where email='you@example.com'"
```

**7. Make content live.** Production serves only templates that a reviewer has promoted
(admin console → Review). For a beta that serves the `in_review` templates too, set:

```bash
aws ssm put-parameter --name /quant-academy/SERVE_UNREVIEWED_CONTENT --type String --value true
```

Then redeploy. You can also set the stack parameter `ServeUnreviewedContent=true` instead.

**Optional: Google sign-in.** Create an OAuth client with the redirect URI
`https://<domain>/api/auth/callback/google`. Then store its credentials and redeploy:

```bash
aws ssm put-parameter --name /quant-academy/AUTH_GOOGLE_ID --type String --value '...'
aws ssm put-parameter --name /quant-academy/AUTH_GOOGLE_SECRET --type SecureString --value '...'
```

Every parameter under `/<AppName>/` becomes an environment variable at the next deploy, and it
overrides the stack's defaults. That's how you change settings without touching the stack.

## Operations

On the instance, `qa` is `docker compose` pointed at the current release:

```bash
aws ssm start-session --target <InstanceId>        # a shell; there is no SSH
sudo qa ps
sudo qa logs -f web                                # also in CloudWatch Logs: /<AppName>/containers
sudo qa run --rm ops jobs once weekly-summary --force
sudo qa-deploy <commit-sha>                        # roll to any release that has been built
```

- **Rollback:** run the *deploy* workflow with `tag` set to an earlier commit SHA. It reuses the
  images already in ECR; the last 10 are kept. Migrations are forward-only and backwards-compatible
  (tech spec §17), so the previous release runs against the current schema.
- **Backups:**
  - A nightly `pg_dump` to `s3://<Bucket>/backups/` at 02:30 UTC, kept 35 days.
  - Daily EBS snapshots of the data volume, 7 kept.
  - To restore a dump:
    `aws s3 cp s3://<Bucket>/backups/<file> - | sudo qa exec -T postgres pg_restore -U qa -d quant_academy --clean --if-exists`.
- **Resizing:** change `InstanceType` in a stack update. The instance stops and starts in about
  a minute, and the data volume stays attached.
- **A new AMI, or anything else that replaces the instance:** the new instance waits until the old
  one has terminated, attaches the data volume, and redeploys the release in `/data/current-release`.
  Expect a few minutes of downtime.
- **Secrets:**
  - `AUTH_SECRET` and the Postgres password are generated on first boot, in `/data/secrets.env`
    on the data volume. They never pass through CloudFormation or GitHub.
  - The containers get AWS credentials from the instance role (SES, S3, SSM, logs).

## Rehearsing locally

The deploy has been run end to end in a container. A local registry stood in for ECR, a stub
`aws` CLI stood in for SSM and S3, and `DOMAIN=localhost` made Caddy issue a local certificate.
The checks covered:
- the migrate and seed;
- health checks;
- the HTTP→HTTPS redirect;
- a magic-link sign-in through Caddy;
- a grader call;
- the jobs scheduler;
- `backup.sh` producing a dump that restores.

To build the images yourself:

```bash
docker buildx build --target web -t qa-web .
docker buildx build --target ops --build-context content=../Quant-Academy-Curriculum-/dist -t qa-ops .
docker buildx build -t qa-grader apps/grader
```
