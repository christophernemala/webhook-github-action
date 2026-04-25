# Webhook GitHub Action with Apify Job Scraper

This repository contains two automation paths:

1. A Render webhook receiver that can trigger GitHub workflows after Render deploy events.
2. A GitHub Actions workflow that can run an Apify job scraper directly.

## Apify Job Scraper

Workflow file:

```text
.github/workflows/run-apify-jobs.yml
```

The workflow calls Apify directly:

```text
https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs
```

It searches UAE finance jobs using these inputs:

```text
Location: Dubai, Abu Dhabi, Sharjah
Roles: Accounts Receivable, Credit Controller, Collections Executive, Order to Cash, O2C, Billing Executive, Revenue Assurance, Finance Operations
Boards: LinkedIn, NaukriGulf, Bayt, Indeed UAE
Salary: AED 10,000 minimum, AED 14,000 target
Freshness: Last 7 days
Max jobs: 100
```

## Required GitHub Secrets for Apify

Go to:

```text
GitHub repository
Settings
Secrets and variables
Actions
New repository secret
```

Add these secrets:

```text
APIFY_API_TOKEN
APIFY_ACTOR_ID
```

Do not commit token values into this repository.

## How to Run the Apify Scraper

Go to:

```text
GitHub repository
Actions
Run Apify Job Scraper
Run workflow
```

If GitHub shows an enable prompt, click:

```text
I understand my workflows, go ahead and enable them
```

## Render Deployment

Render service:

```text
srv-d7e0m5nlk1mc73f2m96g
```

Render URL:

```text
https://webhook-github-action-p3wi.onrender.com
```

Build command:

```bash
pnpm install && pnpm run build
```

Start command:

```bash
pnpm run start
```

Health checks:

```text
/
/health
```

## Required Render Environment Variables

```text
RENDER_WEBHOOK_SECRET
RENDER_API_KEY
GITHUB_API_TOKEN
GITHUB_OWNER_NAME
GITHUB_REPO_NAME
```

Optional Render variables:

```text
GITHUB_WORKFLOW_ID
APIFY_API_TOKEN
APIFY_WEBHOOK_SECRET
APIFY_ACTOR_ID
```

## Development

Install dependencies:

```bash
pnpm install
```

Run development server:

```bash
pnpm run dev
```

Build:

```bash
pnpm run build
```

Start production build:

```bash
pnpm run start
```
