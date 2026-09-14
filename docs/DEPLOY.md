# Deploy

Same shape as the previous site so the existing AWS account and domain carry over:
static web in S3 behind CloudFront, the API in a single-container Elastic Beanstalk
environment, Postgres in RDS.

## Resources (account 826671498662, us-east-1)

| Resource | Name |
|---|---|
| Web bucket | `owt-browser-web-826671498662` |
| ECR repository | `owt-browser-api` |
| EB application / environment | `owt-browser` / `owt-browser-api-prod` (Docker on AL2023) |
| Database | existing RDS instance, new database `owtbrowser` |
| CloudFront | the existing distribution for `onlineweeklytournaments.com`, origins repointed |

## Environment properties (EB)

```
NODE_ENV=production
DATABASE_URL=postgresql://...:5432/owtbrowser?schema=public&connection_limit=10
JWT_SECRET=<64 random chars>
CORS_ORIGINS=https://onlineweeklytournaments.com,https://www.onlineweeklytournaments.com
ENGINE_KIND=stub
ADMIN_USERNAME=<admin>
ADMIN_PASSWORD=<strong>
ADMIN_EMAIL=<email>
PORT=3001
```

## GitHub Actions

Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
Variables: `AWS_REGION`, `WEB_S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `ECR_REPOSITORY`,
`EB_APPLICATION`, `EB_ENVIRONMENT`, `VITE_API_URL` (leave empty when the API is served
from the same domain through CloudFront), `VITE_SOCKET_URL`.

Both deploy workflows skip cleanly until the secrets exist, so CI stays green on forks.

## CloudFront behaviors

| Path | Origin | Notes |
|---|---|---|
| `/api/*` | EB | all methods, no cache, forward Authorization |
| `/socket.io/*` | EB | all methods, no cache, forward all headers (WebSocket upgrade) |
| `/*` (default) | S3 | SPA: 403/404 -> `/index.html` 200 |

## Cutover from the previous site

1. Create the bucket, ECR repo, EB env and database; set the EB properties.
2. Push `main`: CI deploys the API and the web build.
3. Verify at the CloudFront domain, then repoint the default and `/api/*` and
   `/socket.io/*` origins of the existing distribution to the new bucket and EB env.
4. The previous EB environment and bucket stay as they are (nothing deleted); the old
   repository's deploy workflows are switched to manual so a stray push cannot
   redeploy over the live domain.
