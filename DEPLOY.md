# Deploying and custody

Everything below stays on free plans. None of it needs a payment card, and nothing in this setup can produce a bill. Moving to any paid plan would be a recurring cost, which the governance section of the foundational document says must be decided openly before any fund exists; don't do it quietly to get past a limit.

## What this adds to the project's assets

The directory adds three things held in trust for the tables, alongside the domain and the GitHub organization:

- the Cloudflare Worker and its D1 database, in the same Cloudflare account as anytable.org;
- the Resend account that sends the directory's email;
- the Cloudflare Access application that guards the custodian page.

Record them in `GOVERNANCE.md` in any-table/anytable, with the same successor access as the other assets. The database holds hosts' email addresses, so custody of it is custody of personal data.

## One-time setup

**1. Database.** Create it and put its id in `wrangler.jsonc`:

```sh
npx wrangler d1 create anytable-directory
npx wrangler d1 migrations apply anytable-directory --remote
```

The id is not a secret; commit it.

**2. Turnstile.** In the Cloudflare dashboard, create a Turnstile widget for `tables.anytable.org` in Managed mode. Put the site key in `TURNSTILE_SITE_KEY` in `wrangler.jsonc`, and store the secret:

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY
```

**3. Email.** In Resend, add the domain `anytable.org` and add the DNS records it gives you in Cloudflare DNS. Create an API key with sending access only, restricted to that domain, and store it:

```sh
npx wrangler secret put RESEND_API_KEY
```

Mail is sent from `tables@anytable.org` (`MAIL_FROM`). Keep `MAIL_DAILY_CAP` below the Resend free plan's daily allowance; check the current allowance before changing it.

**4. Deploy.** The first time, from a checkout:

```sh
npm ci
npx wrangler deploy
```

This creates the Worker and attaches `tables.anytable.org` as a custom domain. After that, connect the repository in Workers & Pages (the Worker, then Settings, then Builds) so that every push to `main` deploys, with this deploy command:

```sh
npx wrangler d1 migrations apply anytable-directory --remote && npx wrangler deploy
```

That way no Cloudflare token is ever stored in GitHub.

**5. Custodian page (optional).** In Cloudflare Zero Trust (free for up to 50 people), create a self-hosted Access application for `tables.anytable.org/admin`, with a policy allowing only the custodians' email addresses. Put the team domain (such as `anytable.cloudflareaccess.com`) in `ACCESS_TEAM_DOMAIN` and the application's audience tag in `ACCESS_AUD`. Until both are set, `/admin` returns 404. The Worker checks Access's signature itself, so the page stays closed even if the Access policy is misconfigured.

**6. Nightly copy.** Nothing to set up: `.github/workflows/copy-listings.yml` runs on its own once the site is live. Run it once by hand from the Actions tab to create `data/tables.json`.

## Limits, and what happens at them

| Limit | Where it applies | What happens |
| --- | --- | --- |
| Workers Free requests per day | every page | The site stops answering until midnight UTC |
| D1 free rows read or written per day | every page that isn't cached | Pages show an error until midnight UTC |
| `MAIL_DAILY_CAP` (default 90) | every email | New listings and messages are refused until the next day, with a message saying so |
| 10 messages per listing per day | the contact form | Further messages to that table are refused until the next day |
| 5 new listings per address per day | the add form | Refused until the next day |
| 3 lost-link requests per address per day | the lost-link form | Silently ignored until the next day |

Public pages are cached at the edge for five minutes and the export for an hour, which keeps database reads a tiny fraction of the free allowance regardless of traffic.
