import { marked } from "marked";
import rulesMarkdown from "../RULES.md";
import privacyMarkdown from "../PRIVACY.md";
import {
  esc, layout, htmlResponse, redirect, entry, detail, when, errorSummary,
  listingFields, textField, textArea, turnstileWidget,
} from "./html.js";
import {
  countryName, validateListing, validateMessage, isEmail, REMOVAL_REASONS, DAYS,
} from "./validate.js";
import {
  randomId, newToken, sha256hex, verifyTurnstile, turnstileEnabled, sameOrigin, verifyAccess,
} from "./security.js";
import { sendMail, withinLimit, today } from "./mail.js";

const DAY = 86_400_000;
const REMIND_AFTER_DAYS = 150;
const HIDE_AFTER_DAYS = 180;
const DELETE_HIDDEN_AFTER_DAYS = 365;
const PENDING_HOURS = 48;
const CONTACTS_PER_LISTING_PER_DAY = 10;

const PUBLIC_COLS =
  "id, setting, place, address, city, region, country, day, time, timezone, languages, meal, children, accessibility, notes, published_at, confirmed_at";
const DAY_ORDER = `CASE day ${DAYS.map((d, i) => `WHEN '${d}' THEN ${i}`).join(" ")} END`;

const now = () => new Date().toISOString();
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

// ---------------------------------------------------------------- routing

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
      if (method === "GET" || method === "HEAD") {
        if (path === "/") return cached(request, ctx, 300, () => home(env));
        if (path.startsWith("/in/")) return cached(request, ctx, 300, () => countryPage(env, path.slice(4)));
        if (path.startsWith("/t/")) return cached(request, ctx, 300, () => listingPage(env, path.slice(3), url));
        if (path === "/add") return addPage(env);
        if (path === "/sent") return sentPage(env, url);
        if (path === "/confirm") return confirmPage(env, url);
        if (path === "/manage") return managePage(env, url);
        if (path === "/lost") return lostPage(env, url);
        if (path === "/rules") return markdownPage(env, "Listing rules", rulesMarkdown, "/rules");
        if (path === "/privacy") return markdownPage(env, "Privacy", privacyMarkdown, "/privacy");
        if (path === "/data/tables.json") return cached(request, ctx, 3600, () => exportData(env));
        if (path === "/admin") return adminPage(request, env, url);
        return notFound(env);
      }

      if (method === "POST") {
        if (!sameOrigin(request, env)) return htmlResponse("Forbidden", { status: 403 });
        const form = await request.formData();
        if (path === "/add") return addSubmit(request, env, form);
        if (path === "/confirm") return confirmSubmit(env, form);
        if (path === "/manage") return manageSubmit(env, form);
        if (path === "/lost") return lostSubmit(request, env, form);
        if (path === "/admin/remove") return adminRemove(request, env, form);
        const contact = path.match(/^\/t\/([a-z2-9]{10})\/contact$/);
        if (contact) return contactSubmit(request, env, contact[1], form);
        return notFound(env);
      }

      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
    } catch (e) {
      console.log(`[error] ${method} ${path}: ${e && e.message}`);
      return errorPage(env);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(housekeeping(env));
  },
};

// Public pages are cached at the edge for a few minutes. This keeps database
// reads far below the free allowance no matter how often pages are viewed.
async function cached(request, ctx, ttl, build) {
  const cache = caches.default;
  const key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await build();
  if (res.status === 200) {
    const copy = new Response(res.body, res);
    copy.headers.set("Cache-Control", `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(key, copy.clone()));
    return copy;
  }
  return res;
}

// ---------------------------------------------------------------- data access

async function listingByToken(env, id, token) {
  if (typeof id !== "string" || typeof token !== "string" || !/^[a-z2-9]{10}$/.test(id) || token.length < 20) return null;
  const row = await env.DB.prepare("SELECT * FROM listings WHERE id = ?1").bind(id).first();
  if (!row) return null;
  return (await sha256hex(token)) === row.token_hash ? row : null;
}

async function rotateToken(env, id) {
  const token = newToken();
  await env.DB.prepare("UPDATE listings SET token_hash = ?1 WHERE id = ?2").bind(await sha256hex(token), id).run();
  return token;
}

const manageLink = (env, id, token) => `${env.SITE_URL}/manage?id=${id}&t=${token}`;

function summaryLines(l) {
  return `  ${l.place}, ${l.city}\n  ${l.day}s at ${l.time} (${l.timezone})`;
}

// ---------------------------------------------------------------- browse

async function home(env) {
  const { results } = await env.DB.prepare(
    "SELECT country, COUNT(*) AS n FROM listings WHERE status = 'active' GROUP BY country",
  ).all();
  const rows = results
    .map((r) => ({ ...r, name: countryName(r.country) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  const total = rows.reduce((s, r) => s + r.n, 0);

  const list = rows.length
    ? `<ul class="places">${rows
        .map((r) => `<li><a href="/in/${esc(r.country)}">${esc(r.name)}</a> <span class="count">${r.n} ${r.n === 1 ? "table" : "tables"}</span></li>`)
        .join("")}</ul>`
    : `<div class="empty"><p>No tables are listed yet.</p><p>If you keep the gathering with even one other person, <a href="/add">add your table</a> so others nearby can find it.</p></div>`;

  const body = `<h1>Find a table</h1>
<p class="lede">Each table here keeps the weekly gathering: silence, a shared meal, one hard truth, one act of service, one thing each is thankful for, and the line said together. Anyone is welcome at any of them.</p>
${total ? `<h2>By country</h2>` : ""}
${list}
<p>Don't see one near you? <a href="https://anytable.org/">Read the card</a>, find one other person, and <a href="/add">start one</a>. You don't need anyone's permission.</p>`;
  return htmlResponse(layout(env, { title: "Find a table | any table", body, path: "/" }), { cache: 300 });
}

async function countryPage(env, code) {
  code = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return notFound(env);
  const { results } = await env.DB.prepare(
    `SELECT ${PUBLIC_COLS} FROM listings WHERE status = 'active' AND country = ?1
     ORDER BY region COLLATE NOCASE, city COLLATE NOCASE, ${DAY_ORDER}, time`,
  )
    .bind(code)
    .all();
  if (!results.length) return notFound(env);

  let html = "";
  let region = null;
  for (const l of results) {
    if (l.region.toLowerCase() !== (region || "").toLowerCase()) {
      region = l.region;
      html += `<h2>${esc(region)}</h2>\n`;
    }
    html += entry(l) + "\n";
  }
  const name = countryName(code);
  const body = `<p class="crumb"><a href="/">All countries</a></p>
<h1>Tables in ${esc(name)}</h1>
<div class="timetable">
${html}</div>`;
  return htmlResponse(layout(env, { title: `Tables in ${name} | any table`, body }), { cache: 300 });
}

async function listingPage(env, id, url, form = null, errors = {}) {
  if (!/^[a-z2-9]{10}$/.test(id)) return notFound(env);
  const l = await env.DB.prepare(`SELECT ${PUBLIC_COLS} FROM listings WHERE id = ?1 AND status = 'active'`).bind(id).first();
  if (!l) return notFound(env, "This table isn't listed. It may have been removed by its host or expired.");

  const done = url && url.searchParams.get("done") === "sent";
  const v = form ? { name: form.get("name") || "", reply: form.get("reply") || "", message: form.get("message") || "" } : {};
  const contact = done
    ? `<div class="notice" role="status"><p>Your message was sent. The host will reply to your email address if they choose to.</p></div>`
    : `<form method="post" action="/t/${esc(l.id)}/contact" class="form">
${errorSummary(errors)}
${textField("name", "Your name", { value: v.name, errors, max: 80, autocomplete: "name", hintText: "Optional." })}
${textField("reply", "Your email address", { value: v.reply, errors, type: "email", autocomplete: "email", max: 254, hintText: "The host sees this so they can reply." })}
${textArea("message", "Message", { value: v.message, errors, rows: 5, max: 2000, hintText: "Say a little about yourself and ask anything you'd like to know." })}
${honeypot()}
${turnstileWidget(env)}
<p><button type="submit">Send message</button></p>
</form>`;

  const body = `<p class="crumb"><a href="/in/${esc(l.country)}">Tables in ${esc(countryName(l.country))}</a></p>
${detail(l)}
<h2>Write to the host</h2>
<p>Your message goes to the host by email. Their address isn't shown to you, and yours is shown only to them.</p>
${contact}`;
  const status = Object.keys(errors).length ? 422 : 200;
  return htmlResponse(
    layout(env, { title: `${l.place} | any table`, body, turnstile: !done && turnstileEnabled(env) }),
    { status, turnstile: !done, cache: status === 200 && !form ? 300 : 0 },
  );
}

async function contactSubmit(request, env, id, form) {
  if (form.get("website")) return redirect(`/t/${id}?done=sent`);
  const l = await env.DB.prepare("SELECT * FROM listings WHERE id = ?1 AND status = 'active'").bind(id).first();
  if (!l) return notFound(env);

  const { data, errors } = validateMessage(form);
  if (!(await verifyTurnstile(env, form.get("cf-turnstile-response"), request.headers.get("CF-Connecting-IP")))) {
    errors.turnstile = "The spam check didn't complete. Try again.";
  }
  if (Object.keys(errors).length) return listingPage(env, id, null, form, errors);

  if (!(await withinLimit(env, `contact:${id}`, CONTACTS_PER_LISTING_PER_DAY))) {
    return listingPage(env, id, null, form, { message: "This table has received as many messages as it can today. Try again tomorrow." });
  }

  const from = data.name ? `${data.name} (${data.reply})` : data.reply;
  const sent = await sendMail(env, {
    to: l.email,
    replyTo: data.reply,
    subject: `A message about your table: ${l.place}`,
    text: `${from} wrote to you through the any table directory about your listing:

${summaryLines(l)}

----
${data.message}
----

Replying to this email goes straight to them. Your address hasn't been shared with them unless you reply.

The directory doesn't vet anyone. If you invite them, meet somewhere public the first time.

To stop messages, remove your listing using your manage link. If you've lost it, get a new one at ${env.SITE_URL}/lost`,
  });
  if (!sent) {
    return listingPage(env, id, null, form, { message: "The message couldn't be sent right now. Try again tomorrow." });
  }
  return redirect(`/t/${id}?done=sent`);
}

// ---------------------------------------------------------------- add

function honeypot() {
  return `<div class="hp" aria-hidden="true"><label for="f-website">Leave this empty</label><input id="f-website" name="website" tabindex="-1" autocomplete="off"></div>`;
}

function addPage(env, values = {}, errors = {}) {
  const body = `<h1>Add a table</h1>
<p class="lede">List a table that keeps the weekly gathering so people nearby can find it. It takes a few minutes, and you'll get an email with a link to publish it.</p>
<p>Before you start, read the <a href="/rules">listing rules</a>. In short: no home addresses, no one's personal details, no charge to attend, and nothing that isn't a table. People write to you through a form; your email address is never shown.</p>
<form method="post" action="/add" class="form">
${errorSummary(errors)}
${listingFields(values, errors)}
${textField("email", "Your email address", { value: values.email, errors, type: "email", autocomplete: "email", max: 254, hintText: "Never shown. We send the link to publish and manage the listing here, and forward messages from people who want to come." })}
<div class="field${errors.rules ? " has-error" : ""}">
  ${errors.rules ? `<span class="error">${esc(errors.rules)}</span>` : ""}
  <label class="choice"><input type="checkbox" id="f-rules" name="rules" value="yes"${values.rulesChecked ? " checked" : ""}> <span>This listing follows the <a href="/rules">listing rules</a>, and I understand it expires unless I confirm it's still meeting every six months.</span></label>
</div>
${honeypot()}
${turnstileWidget(env)}
<p><button type="submit">Email me the link to publish</button></p>
</form>`;
  const status = Object.keys(errors).length ? 422 : 200;
  return htmlResponse(layout(env, { title: "Add a table | any table", body, path: "/add", turnstile: turnstileEnabled(env) }), { status, turnstile: true });
}

async function addSubmit(request, env, form) {
  if (form.get("website")) return redirect("/sent?to=add");
  const { data, errors } = validateListing(form);
  if (!(await verifyTurnstile(env, form.get("cf-turnstile-response"), request.headers.get("CF-Connecting-IP")))) {
    errors.turnstile = "The spam check didn't complete. Try again.";
  }
  if (Object.keys(errors).length) return addPage(env, { ...data, rulesChecked: form.get("rules") === "yes" }, errors);

  const emailKey = `add:${await sha256hex(data.email)}`;
  if (!(await withinLimit(env, emailKey, 5))) {
    return addPage(env, { ...data, rulesChecked: true }, { email: "This address has started five listings today. Try again tomorrow." });
  }

  const id = randomId();
  const token = newToken();
  const t = now();
  await env.DB.prepare(
    `INSERT INTO listings (id, status, setting, place, address, city, region, country, day, time, timezone,
       languages, meal, children, accessibility, notes, email, token_hash, created_at, updated_at)
     VALUES (?1, 'pending', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)`,
  )
    .bind(id, data.setting, data.place, data.address || null, data.city, data.region, data.country, data.day,
      data.time, data.timezone, data.languages || null, data.meal, data.children, data.accessibility || null,
      data.notes || null, data.email, await sha256hex(token), t)
    .run();

  const sent = await sendMail(env, {
    to: data.email,
    subject: "Publish your table",
    text: `Someone, hopefully you, asked to list a table in the any table directory:

${summaryLines(data)}

To publish it, open this link and press Publish:
${env.SITE_URL}/confirm?id=${id}&t=${token}

Keep this email. The same link lets you edit the listing, confirm that the table is still meeting, or remove it. Anyone with the link can do those things, so don't forward it.

If you didn't ask for this, ignore this email. The listing will be deleted in two days.`,
  });
  if (!sent) {
    await env.DB.prepare("DELETE FROM listings WHERE id = ?1").bind(id).run();
    return addPage(env, { ...data, rulesChecked: true }, { email: "The email couldn't be sent right now, so nothing was saved. Try again tomorrow." });
  }
  return redirect("/sent?to=add");
}

function sentPage(env, url) {
  const lost = url.searchParams.get("to") === "lost";
  const body = lost
    ? `<h1>Check your email</h1>
<p>If that address has any listings, we've sent it a new link for each one. Earlier links for those listings no longer work.</p>
<p>It can take a few minutes to arrive. Check your spam folder if it doesn't.</p>`
    : `<h1>Check your email</h1>
<p>We've sent you a link. Open it and press Publish, and your table will be listed.</p>
<p>It can take a few minutes to arrive, so check your spam folder if you don't see it. The listing isn't public until you publish it, and it's deleted after two days if you don't.</p>`;
  return htmlResponse(layout(env, { title: "Check your email | any table", body }));
}

// ---------------------------------------------------------------- confirm and manage

function invalidLink(env) {
  const body = `<h1>This link doesn't work</h1>
<p>It may be mistyped, or it may have been replaced by a newer link. Every time a new link is sent for a listing, the older ones stop working.</p>
<p><a href="/lost">Get a new link</a> sent to the address you listed with.</p>`;
  return htmlResponse(layout(env, { title: "Link not valid | any table", body }), { status: 404 });
}

async function confirmPage(env, url) {
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("t");
  const l = await listingByToken(env, id, token);
  if (!l) return invalidLink(env);
  if (l.status !== "pending") return redirect(`/manage?id=${id}&t=${encodeURIComponent(token)}`);
  const body = `<h1>Publish your table</h1>
<p>This is how the listing will appear. Nothing is public until you press Publish.</p>
${detail(l)}
<form method="post" action="/confirm" class="form">
  <input type="hidden" name="id" value="${esc(id)}">
  <input type="hidden" name="t" value="${esc(token)}">
  <p><button type="submit">Publish</button></p>
</form>
<p>Need to change something first? Publish it, then edit it on the next page.</p>`;
  return htmlResponse(layout(env, { title: "Publish your table | any table", body }));
}

async function confirmSubmit(env, form) {
  const id = form.get("id");
  const token = form.get("t");
  const l = await listingByToken(env, id, token);
  if (!l) return invalidLink(env);
  const t = now();
  await env.DB.prepare(
    `UPDATE listings SET status = 'active', published_at = COALESCE(published_at, ?1),
       confirmed_at = ?1, reminded_at = NULL, updated_at = ?1 WHERE id = ?2`,
  ).bind(t, id).run();
  return redirect(`/manage?id=${id}&t=${encodeURIComponent(token)}&done=published`);
}

const MANAGE_NOTICES = {
  published: "Published. Your table is listed. It can take up to five minutes to appear everywhere.",
  saved: "Saved. Changes can take up to five minutes to appear.",
  confirmed: "Confirmed. Thanks for letting people know the table is still meeting.",
};

async function managePage(env, url, form = null, errors = {}) {
  const id = form ? form.get("id") : url.searchParams.get("id");
  const token = form ? form.get("t") : url.searchParams.get("t");
  const l = await listingByToken(env, id, token);
  if (!l) return invalidLink(env);

  const done = url ? MANAGE_NOTICES[url.searchParams.get("done")] : "";
  const confirmedAt = l.confirmed_at ? new Date(l.confirmed_at) : null;
  const hideOn = confirmedAt ? new Date(confirmedAt.getTime() + HIDE_AFTER_DAYS * DAY).toISOString().slice(0, 10) : "";

  let status;
  if (l.status === "active") {
    status = `<p>Listed. The public page is <a href="/t/${esc(l.id)}">${esc(env.SITE_URL.replace(/^https?:\/\//, ""))}/t/${esc(l.id)}</a>. It stays listed until ${esc(hideOn)} unless you confirm it's still meeting before then; we'll email you a reminder a month ahead.</p>`;
  } else if (l.status === "hidden") {
    status = `<p>Hidden. This listing wasn't confirmed for six months, so it's no longer shown. If the table is still meeting, confirm below and it will be listed again.</p>`;
  } else {
    status = `<p>Not published yet. Confirm below to publish it.</p>`;
  }

  const hidden = `<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="t" value="${esc(token)}">`;
  const values = form
    ? Object.fromEntries(["setting", "place", "address", "city", "region", "country", "day", "time", "timezone", "languages", "meal", "children", "accessibility", "notes"].map((k) => [k, form.get(k) || ""]))
    : l;

  const body = `<h1>Manage your table</h1>
${done ? `<div class="notice" role="status"><p>${esc(done)}</p></div>` : ""}
<div class="status">
  ${when(l)}
  <div class="what"><h2 class="as-h3">${esc(l.place)}</h2>${status}</div>
</div>
<p class="keep">Keep the email with this page's link. Anyone who has it can change or remove this listing, so don't share it.</p>

<h2>Still meeting?</h2>
<form method="post" action="/manage" class="inline">
  ${hidden}<input type="hidden" name="action" value="confirm">
  <button type="submit">${l.status === "active" ? "Yes, we're still meeting" : l.status === "hidden" ? "Yes, list it again" : "Publish"}</button>
</form>

<h2>Edit the listing</h2>
<form method="post" action="/manage" class="form">
  ${hidden}<input type="hidden" name="action" value="update">
  ${errorSummary(errors)}
  ${listingFields(values, errors)}
  <p><button type="submit">Save changes</button></p>
</form>
<p class="hint-block">To change the email address, remove this listing and add it again from the new address.</p>

<h2>Remove the listing</h2>
<form method="post" action="/manage" class="form">
  ${hidden}<input type="hidden" name="action" value="remove">
  <div class="field">
    <label class="choice"><input type="checkbox" name="sure" value="yes" required> <span>Remove this listing and delete my email address from the directory. This can't be undone.</span></label>
  </div>
  <p><button type="submit" class="quiet">Remove listing</button></p>
</form>`;
  const code = Object.keys(errors).length ? 422 : 200;
  return htmlResponse(layout(env, { title: "Manage your table | any table", body }), { status: code });
}

async function manageSubmit(env, form) {
  const id = form.get("id");
  const token = form.get("t");
  const l = await listingByToken(env, id, token);
  if (!l) return invalidLink(env);
  const action = form.get("action");
  const back = (done) => redirect(`/manage?id=${id}&t=${encodeURIComponent(token)}&done=${done}`);
  const t = now();

  if (action === "confirm") {
    await env.DB.prepare(
      `UPDATE listings SET status = 'active', published_at = COALESCE(published_at, ?1),
         confirmed_at = ?1, reminded_at = NULL, updated_at = ?1 WHERE id = ?2`,
    ).bind(t, id).run();
    return back(l.status === "pending" ? "published" : "confirmed");
  }

  if (action === "update") {
    const { data, errors } = validateListing(form, { requireEmail: false });
    if (Object.keys(errors).length) return managePage(env, null, form, errors);
    // Editing a listing is also a sign that the table is still meeting.
    const becomesActive = l.status !== "pending";
    await env.DB.prepare(
      `UPDATE listings SET setting = ?1, place = ?2, address = ?3, city = ?4, region = ?5, country = ?6,
         day = ?7, time = ?8, timezone = ?9, languages = ?10, meal = ?11, children = ?12,
         accessibility = ?13, notes = ?14, updated_at = ?15,
         confirmed_at = CASE WHEN ?16 THEN ?15 ELSE confirmed_at END,
         reminded_at  = CASE WHEN ?16 THEN NULL ELSE reminded_at END,
         status       = CASE WHEN ?16 THEN 'active' ELSE status END
       WHERE id = ?17`,
    )
      .bind(data.setting, data.place, data.address || null, data.city, data.region, data.country, data.day,
        data.time, data.timezone, data.languages || null, data.meal, data.children, data.accessibility || null,
        data.notes || null, t, becomesActive ? 1 : 0, id)
      .run();
    return back("saved");
  }

  if (action === "remove") {
    if (form.get("sure") !== "yes") return managePage(env, null, form, {});
    await env.DB.prepare("DELETE FROM listings WHERE id = ?1").bind(id).run();
    const body = `<h1>Removed</h1>
<p>The listing is gone, and your email address has been deleted from the directory. It can take up to five minutes to disappear from every page, and it drops out of the public copy on GitHub at the next nightly update.</p>
<p>If the table starts meeting again, you can <a href="/add">add it again</a> any time.</p>`;
    return htmlResponse(layout(env, { title: "Removed | any table", body }));
  }

  return invalidLink(env);
}

// ---------------------------------------------------------------- lost link

function lostPage(env, url, value = "", errors = {}) {
  const body = `<h1>Get a new link</h1>
<p>Enter the address you listed with. If it has any listings, we'll email it a new manage link for each one. Older links stop working when new ones are sent.</p>
<form method="post" action="/lost" class="form">
${errorSummary(errors)}
${textField("email", "Your email address", { value, errors, type: "email", autocomplete: "email", max: 254 })}
${turnstileWidget(env)}
<p><button type="submit">Email me new links</button></p>
</form>`;
  const status = Object.keys(errors).length ? 422 : 200;
  return htmlResponse(layout(env, { title: "Get a new link | any table", body, turnstile: turnstileEnabled(env) }), { status, turnstile: true });
}

async function lostSubmit(request, env, form) {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const errors = {};
  if (!isEmail(email)) errors.email = "Enter the email address you listed with.";
  if (!(await verifyTurnstile(env, form.get("cf-turnstile-response"), request.headers.get("CF-Connecting-IP")))) {
    errors.turnstile = "The spam check didn't complete. Try again.";
  }
  if (Object.keys(errors).length) return lostPage(env, null, email, errors);

  // Same response whether or not the address has listings, so this page can't
  // be used to discover who has listed a table.
  if (await withinLimit(env, `lost:${await sha256hex(email)}`, 3)) {
    const { results } = await env.DB.prepare("SELECT * FROM listings WHERE email = ?1").bind(email).all();
    if (results.length) {
      const lines = [];
      for (const l of results) {
        const token = await rotateToken(env, l.id);
        lines.push(`${summaryLines(l)}\n  ${manageLink(env, l.id, token)}`);
      }
      await sendMail(env, {
        to: email,
        subject: "Your links to manage your tables",
        text: `Someone, hopefully you, asked for new links to manage the tables listed from this address:

${lines.join("\n\n")}

Each link lets you edit the listing, confirm it's still meeting, or remove it. Earlier links for these listings no longer work. Don't forward this email.

If you didn't ask for this, you can ignore it. Your listings haven't changed.`,
      });
    }
  }
  return redirect("/sent?to=lost");
}

// ---------------------------------------------------------------- static text

function markdownPage(env, title, markdown, path) {
  const html = marked.parse(markdown.replace(/^# .*\n/, ""));
  const body = `<h1>${esc(title)}</h1>\n${html}`;
  return htmlResponse(layout(env, { title: `${title} | any table`, body, path }), { cache: 3600 });
}

// ---------------------------------------------------------------- export

async function exportData(env) {
  const { results: listings } = await env.DB.prepare(
    `SELECT ${PUBLIC_COLS} FROM listings WHERE status = 'active'
     ORDER BY country, region COLLATE NOCASE, city COLLATE NOCASE, id`,
  ).all();
  const { results: removals } = await env.DB.prepare(
    "SELECT id, city, region, country, reason, removed_at FROM removals ORDER BY removed_at, id",
  ).all();
  const data = {
    about: "Public listings from the any table directory at tables.anytable.org. Contact details are never included.",
    license: "CC0-1.0",
    listings: listings.map((l) => {
      const out = {};
      for (const [k, v] of Object.entries(l)) if (v !== null && v !== "") out[k] = v;
      return out;
    }),
    removals: removals.map((r) => ({ ...r, reason: REMOVAL_REASONS[r.reason] || r.reason })),
  };
  return new Response(JSON.stringify(data, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

// ---------------------------------------------------------------- admin

async function adminPage(request, env, url) {
  if (!(await verifyAccess(request, env))) return notFound(env);
  const { results } = await env.DB.prepare(
    `SELECT id, status, setting, place, city, region, country, day, time, confirmed_at
     FROM listings WHERE status IN ('active', 'hidden')
     ORDER BY country, region COLLATE NOCASE, city COLLATE NOCASE`,
  ).all();
  const reasons = Object.entries(REMOVAL_REASONS)
    .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`)
    .join("");
  const rows = results
    .map(
      (l) => `<tr>
  <td><a href="/t/${esc(l.id)}">${esc(l.place)}</a><br><span class="hint">${esc(l.city)}, ${esc(l.region)}, ${esc(l.country)}; ${esc(l.day)} ${esc(l.time)}; ${esc(l.status)}, confirmed ${esc((l.confirmed_at || "").slice(0, 10))}</span></td>
  <td><form method="post" action="/admin/remove" class="inline"><input type="hidden" name="id" value="${esc(l.id)}"><select name="reason" required aria-label="Reason"><option value="">Reason</option>${reasons}</select> <button type="submit" class="quiet">Remove</button></form></td>
</tr>`,
    )
    .join("\n");
  const done = url.searchParams.get("done") === "removed";
  const body = `<h1>Custodian page</h1>
${done ? `<div class="notice" role="status"><p>Removed. The host has been emailed the reason, and the removal is recorded in the public data.</p></div>` : ""}
<p>Remove a listing only for one of the published reasons in the <a href="/rules">listing rules</a>. You can't see hosts' email addresses here, and you can't edit a listing; only its host can. Every removal is published with its reason.</p>
${results.length ? `<table class="admin">${rows}</table>` : "<p>No listings.</p>"}`;
  return htmlResponse(layout(env, { title: "Custodian page | any table", body }));
}

async function adminRemove(request, env, form) {
  if (!(await verifyAccess(request, env))) return notFound(env);
  const id = String(form.get("id") || "");
  const reason = String(form.get("reason") || "");
  if (!(reason in REMOVAL_REASONS)) return redirect("/admin");
  const l = await env.DB.prepare("SELECT * FROM listings WHERE id = ?1").bind(id).first();
  if (!l) return redirect("/admin");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO removals (id, city, region, country, reason, removed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(l.id, l.city, l.region, l.country, reason, now()),
    env.DB.prepare("DELETE FROM listings WHERE id = ?1").bind(l.id),
  ]);
  await sendMail(env, {
    to: l.email,
    subject: "Your table was removed from the directory",
    text: `A custodian of the any table directory removed this listing:

${summaryLines(l)}

Reason: ${REMOVAL_REASONS[reason]}

Removals are allowed only for the reasons published in the listing rules at ${env.SITE_URL}/rules, and every removal is recorded publicly with its reason. Your email address has been deleted from the directory.

If you think this was a mistake, or the problem is fixed, you're welcome to add the table again. To raise the removal publicly, open an issue at https://github.com/any-table/directory.`,
  });
  return redirect("/admin?done=removed");
}

// ---------------------------------------------------------------- errors

function notFound(env, message) {
  const body = `<h1>Not found</h1>
<p>${esc(message || "There's no page at this address.")}</p>
<p><a href="/">Find a table</a> or <a href="/add">add one</a>.</p>`;
  return htmlResponse(layout(env, { title: "Not found | any table", body }), { status: 404 });
}

function errorPage(env) {
  const body = `<h1>Something went wrong</h1>
<p>The directory couldn't finish that request. If it keeps happening, the directory may have reached its free daily limit, which resets at midnight UTC. Try again later.</p>`;
  return htmlResponse(layout(env, { title: "Error | any table", body }), { status: 500 });
}

// ---------------------------------------------------------------- daily job

export async function housekeeping(env) {
  const log = [];

  // Unpublished listings are deleted after two days, with their email address.
  const pending = await env.DB.prepare("DELETE FROM listings WHERE status = 'pending' AND created_at < ?1")
    .bind(ago(PENDING_HOURS / 24)).run();
  log.push(`pending deleted: ${pending.meta.changes}`);

  // A month before a listing expires, remind its host.
  const { results: toRemind } = await env.DB.prepare(
    `SELECT * FROM listings WHERE status = 'active' AND reminded_at IS NULL
     AND confirmed_at < ?1 AND confirmed_at >= ?2 LIMIT 40`,
  ).bind(ago(REMIND_AFTER_DAYS), ago(HIDE_AFTER_DAYS)).all();
  let reminded = 0;
  for (const l of toRemind) {
    const token = newToken();
    const hideOn = new Date(new Date(l.confirmed_at).getTime() + HIDE_AFTER_DAYS * DAY).toISOString().slice(0, 10);
    const sent = await sendMail(env, {
      to: l.email,
      subject: "Is your table still meeting?",
      text: `Your table has been listed in the any table directory for five months since you last confirmed it:

${summaryLines(l)}

If it's still meeting, open this link and press "Yes, we're still meeting":
${manageLink(env, l.id, token)}

If you do nothing, the listing will be hidden on ${hideOn}, so nobody turns up to an empty room. You can list it again from the same link for six months after that.

This link replaces any earlier ones for this listing. Don't forward it.`,
    });
    if (!sent) break; // daily mail cap reached; continue tomorrow
    await env.DB.prepare("UPDATE listings SET token_hash = ?1, reminded_at = ?2 WHERE id = ?3")
      .bind(await sha256hex(token), now(), l.id).run();
    reminded++;
  }
  log.push(`reminded: ${reminded}`);

  // Listings not confirmed for six months are hidden.
  const { results: toHide } = await env.DB.prepare(
    "SELECT * FROM listings WHERE status = 'active' AND confirmed_at < ?1 LIMIT 40",
  ).bind(ago(HIDE_AFTER_DAYS)).all();
  for (const l of toHide) {
    await env.DB.prepare("UPDATE listings SET status = 'hidden', updated_at = ?1 WHERE id = ?2").bind(now(), l.id).run();
    const token = await rotateToken(env, l.id);
    await sendMail(env, {
      to: l.email,
      subject: "Your table is no longer listed",
      text: `This table hasn't been confirmed for six months, so it's been hidden from the any table directory:

${summaryLines(l)}

If it's still meeting, open this link and press "Yes, list it again":
${manageLink(env, l.id, token)}

If you do nothing, the listing and your email address will be deleted in six months.`,
    });
  }
  log.push(`hidden: ${toHide.length}`);

  // Hidden listings are deleted, with their email address, after a year.
  const deleted = await env.DB.prepare("DELETE FROM listings WHERE status = 'hidden' AND confirmed_at < ?1")
    .bind(ago(DELETE_HIDDEN_AFTER_DAYS)).run();
  log.push(`hidden deleted: ${deleted.meta.changes}`);

  // Rate-limit counters are only needed for the current day.
  const twoDaysAgo = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM counters WHERE day < ?1").bind(twoDaysAgo).run();

  console.log(`[housekeeping] ${today()} ${log.join(", ")}`);
  return log;
}
