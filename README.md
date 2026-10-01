# directory

The directory of tables at [tables.anytable.org](https://tables.anytable.org): where people find a table near them, and where hosts list their own.

It follows the rules in the [foundational document](https://anytable.org/foundational/). Anyone may list a table. Only the person who listed it can change or remove it. Listings expire unless their host confirms them. No one controls the list: every night the public listings are copied into [`data/tables.json`](data/tables.json) here, under CC0, so anyone can rebuild the directory if this website ever goes away.

- [Listing rules](RULES.md), also shown at [/rules](https://tables.anytable.org/rules)
- [Privacy](PRIVACY.md), also shown at [/privacy](https://tables.anytable.org/privacy)
- [Deploying and custody](DEPLOY.md)

## How it works

A host fills in a form and gets an email with a private link. Opening it and pressing Publish lists the table. The same link lets them edit the listing, confirm it's still meeting, or remove it. There are no accounts or passwords.

People who want to come write through a form on the listing. The message is forwarded to the host by email, and the host's address is never shown. Home tables are listed by area only; the host shares the address privately.

Five months after a host last confirmed a listing, they get a reminder. At six months an unconfirmed listing is hidden. A year after its last confirmation a hidden listing is deleted, with its email address. Unpublished listings are deleted after two days.

Custodians can remove a listing only for one of the reasons published in the rules. They can't see email addresses or edit listings, the host is emailed the reason, and every removal is recorded in the public data.

## What it runs on

One Cloudflare Worker with a D1 database, all within the Cloudflare Workers Free plan. If a daily free limit is ever reached, the directory stops answering until midnight UTC; it never runs up a bill. Pages are server-rendered HTML with no JavaScript of their own, no cookies, and no analytics. The three forms that could be abused (adding a table, writing to a host, and requesting a new link) use Cloudflare Turnstile. Email goes through Resend, capped below its free daily allowance.

| Path | What it is |
| --- | --- |
| `src/index.js` | Routes, pages, and the daily job |
| `src/html.js` | Page layout and the listing and form markup |
| `src/validate.js` | Validation that enforces the listing rules |
| `src/security.js` | Tokens, Turnstile, and Cloudflare Access checks |
| `src/mail.js` | Email and daily rate limits |
| `migrations/` | The database schema |
| `public/` | Stylesheet (shared with anytable.org), favicon, robots.txt |
| `scripts/smoke.sh` | The end-to-end test |

## Local development

Node 20 or later.

```sh
npm ci
printf 'TURNSTILE_DISABLED=true\nMAIL_LOG_ONLY=true\nSITE_URL=http://localhost:8787\n' > .dev.vars
npm run migrate:local
npm run dev
```

Open http://localhost:8787. `MAIL_LOG_ONLY` prints email to the terminal instead of sending it, so the publish and manage links appear there, and `TURNSTILE_DISABLED` turns off the spam check. Both are for local use only and are never set in production. Without `MAIL_LOG_ONLY`, a missing `RESEND_API_KEY` makes every email fail rather than print.

To run the daily job by hand, start the dev server with `npx wrangler dev --test-scheduled` and open http://localhost:8787/__scheduled.

## Tests

```sh
npm test
```

This starts the Worker against a fresh local database and walks through the whole flow: the listing rules, adding and publishing, editing, messaging a host, replacing a lost link, the public export, the daily job, and removal. Pull requests run it automatically.

## License

The code, rules, and public listings are dedicated to the public domain under [CC0 1.0 Universal](LICENSE).
