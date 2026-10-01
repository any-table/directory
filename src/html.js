import { countries, countryName, timezones, DAYS, MEALS, CHILDREN } from "./validate.js";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NAV = [
  ["/", "Find a table"],
  ["/add", "Add a table"],
  ["/rules", "Listing rules"],
  ["/privacy", "Privacy"],
];

export function layout(env, { title, body, path = "", turnstile = false, description }) {
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === path ? ' aria-current="page"' : ""}>${label}</a>`,
  ).join("\n        ");
  const script = turnstile
    ? '\n  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description || "Find a table keeping the any table gathering near you, or add your own.")}">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">${script}
</head>
<body>
  <a class="skip" href="#main">Skip to the content</a>
  <header class="site">
    <a class="name" href="https://anytable.org/">any table</a>
    <nav aria-label="Directory">
        ${nav}
    </nav>
  </header>
  <main id="main">
${body}
  </main>
  <footer class="site">
    <p>This directory is ownerless. Only the person who posts a listing can change or remove it, listings expire unless their host confirms them, and the public listings are copied nightly to <a href="https://github.com/any-table/directory">GitHub</a> under CC0, so anyone can rebuild the list.</p>
    <p>Listing a table is not an endorsement. No one vets these tables; meet somewhere public the first time. <a href="https://anytable.org/">The text</a> is at anytable.org.</p>
  </footer>
</body>
</html>`;
}

// Security headers for every HTML response. Turnstile pages may load its script.
export function htmlResponse(html, { status = 200, turnstile = false, cache = 0 } = {}) {
  const ts = turnstile ? " https://challenges.cloudflare.com" : "";
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": `default-src 'none'; style-src 'self'; img-src 'self'; script-src${ts || " 'none'"}; frame-src${ts || " 'none'"}; connect-src${ts || " 'none'"}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    "Cache-Control": cache ? `public, max-age=${cache}` : "no-store",
  };
  return new Response(html, { status, headers });
}

export function redirect(location) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

// ---------- listing display ----------

function tzLabel(tz) {
  const city = tz.split("/").pop().replace(/_/g, " ");
  return `${city} time`;
}

export function when(listing) {
  return `<p class="when"><span class="day">${esc(listing.day)}s</span> <span class="time">${esc(listing.time)} <span class="tz">${esc(tzLabel(listing.timezone))}</span></span></p>`;
}

export function whereLine(listing) {
  return `${esc(listing.city)}, ${esc(listing.region)}, ${esc(countryName(listing.country))}`;
}

export function entry(listing) {
  const home = listing.setting === "home" ? " <span class=\"kind\">(home table)</span>" : "";
  return `<article class="entry">
  ${when(listing)}
  <div class="what">
    <h3><a href="/t/${esc(listing.id)}">${esc(listing.place)}</a>${home}</h3>
    <p>${esc(listing.city)}, ${esc(listing.region)}</p>
  </div>
</article>`;
}

export function detail(listing) {
  const rows = [];
  if (listing.setting === "public" && listing.address) rows.push(["Address", esc(listing.address)]);
  if (listing.setting === "home") rows.push(["Address", "A home table. The host shares the address privately with people who write."]);
  rows.push(["Where", whereLine(listing)]);
  rows.push(["Meal", esc(MEALS[listing.meal] || listing.meal)]);
  rows.push(["Children", esc(CHILDREN[listing.children] || listing.children)]);
  if (listing.languages) rows.push(["Languages", esc(listing.languages)]);
  if (listing.accessibility) rows.push(["Access", esc(listing.accessibility)]);
  if (listing.notes) rows.push(["Notes", esc(listing.notes)]);
  const confirmed = listing.confirmed_at ? listing.confirmed_at.slice(0, 10) : "";
  if (confirmed) rows.push(["Last confirmed", esc(confirmed)]);
  return `<div class="entry entry-detail">
  ${when(listing)}
  <div class="what">
    <h1>${esc(listing.place)}</h1>
    <dl class="facts">
${rows.map(([k, v]) => `      <dt>${k}</dt><dd>${v}</dd>`).join("\n")}
    </dl>
  </div>
</div>`;
}

// ---------- forms ----------

export function errorSummary(errors) {
  const keys = Object.keys(errors);
  if (!keys.length) return "";
  return `<div class="errors" role="alert">
  <p>Please fix ${keys.length === 1 ? "this" : "these"} before continuing:</p>
  <ul>${keys.map((k) => `<li><a href="#f-${k}">${esc(errors[k])}</a></li>`).join("")}</ul>
</div>`;
}

function hint(text) {
  return text ? `<span class="hint">${text}</span>` : "";
}

function err(errors, name) {
  return errors[name] ? `<span class="error">${esc(errors[name])}</span>` : "";
}

export function textField(name, label, { value = "", errors = {}, hintText = "", type = "text", required = false, autocomplete = "", list = "", max = 0 } = {}) {
  const attrs = [
    `type="${type}"`,
    `id="f-${name}"`,
    `name="${name}"`,
    `value="${esc(value)}"`,
    required ? "required" : "",
    autocomplete ? `autocomplete="${autocomplete}"` : "",
    list ? `list="${list}"` : "",
    max ? `maxlength="${max}"` : "",
    errors[name] ? 'aria-invalid="true"' : "",
  ].filter(Boolean);
  return `<div class="field${errors[name] ? " has-error" : ""}">
  <label for="f-${name}">${label}</label>${hint(hintText)}${err(errors, name)}
  <input ${attrs.join(" ")}>
</div>`;
}

export function textArea(name, label, { value = "", errors = {}, hintText = "", rows = 4, max = 0, required = false } = {}) {
  return `<div class="field${errors[name] ? " has-error" : ""}">
  <label for="f-${name}">${label}</label>${hint(hintText)}${err(errors, name)}
  <textarea id="f-${name}" name="${name}" rows="${rows}"${max ? ` maxlength="${max}"` : ""}${required ? " required" : ""}${errors[name] ? ' aria-invalid="true"' : ""}>${esc(value)}</textarea>
</div>`;
}

export function selectField(name, label, options, { value = "", errors = {}, hintText = "", placeholder = "Choose one" } = {}) {
  const opts = options
    .map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`)
    .join("");
  return `<div class="field${errors[name] ? " has-error" : ""}">
  <label for="f-${name}">${label}</label>${hint(hintText)}${err(errors, name)}
  <select id="f-${name}" name="${name}"${errors[name] ? ' aria-invalid="true"' : ""}><option value="">${placeholder}</option>${opts}</select>
</div>`;
}

export function radios(name, legend, options, { value = "", errors = {}, hintText = "" } = {}) {
  const items = options
    .map(
      ([v, l, h], i) => `<label class="choice"><input type="radio" name="${name}" value="${esc(v)}"${i === 0 ? ` id="f-${name}"` : ""}${v === value ? " checked" : ""}> <span>${l}${h ? `<span class="hint">${h}</span>` : ""}</span></label>`,
    )
    .join("\n  ");
  return `<fieldset class="field${errors[name] ? " has-error" : ""}">
  <legend>${legend}</legend>${hint(hintText)}${err(errors, name)}
  ${items}
</fieldset>`;
}

export function turnstileWidget(env) {
  if (env.TURNSTILE_DISABLED === "true") return "";
  return `<div class="field"><div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITE_KEY)}" data-theme="auto"></div></div>`;
}

// The listing form, shared by "add" and "manage".
export function listingFields(v = {}, errors = {}) {
  const zones = timezones();
  const zoneList = zones.length
    ? `<datalist id="zones">${zones.map((z) => `<option value="${esc(z)}">`).join("")}</datalist>`
    : "";
  return `
${radios("setting", "Where does the table meet?", [
    ["public", "A public place", "A library, park, community room, cafe. The address is shown."],
    ["home", "A home", "Only the area is shown. You share the address privately with people who write to you."],
  ], { value: v.setting, errors })}
${textField("place", "Place", { value: v.place, errors, max: 120, hintText: "For a public place, its name and room, such as \"Springfield Public Library, community room 2.\" For a home, just the area, such as \"a home in east Springfield.\"" })}
${textField("address", "Street address", { value: v.address, errors, max: 160, hintText: "Public places only. Leave this empty for a home table." })}
${textField("city", "City or town", { value: v.city, errors, max: 80, autocomplete: "address-level2" })}
${textField("region", "State, province, or region", { value: v.region, errors, max: 80, autocomplete: "address-level1" })}
${selectField("country", "Country", countries().map((c) => [c.code, c.name]), { value: v.country, errors })}
<div class="row">
${selectField("day", "Day", DAYS.map((d) => [d, d]), { value: v.day, errors })}
${textField("time", "Time", { value: v.time, errors, type: "time", hintText: "24-hour, local time" })}
</div>
${textField("timezone", "Time zone", { value: v.timezone, errors, list: "zones", max: 64, hintText: "Start typing your nearest large city, such as America/Phoenix or Europe/London." })}
${zoneList}
${radios("meal", "How does the meal work?", Object.entries(MEALS), { value: v.meal, errors })}
${radios("children", "Children", Object.entries(CHILDREN), { value: v.children, errors })}
${textField("languages", "Languages spoken", { value: v.languages, errors, max: 60, hintText: "Optional, such as \"English, Spanish.\"" })}
${textField("accessibility", "Access", { value: v.accessibility, errors, max: 200, hintText: "Optional. Step-free entrance, quiet room, parking, and so on." })}
${textArea("notes", "Anything else a newcomer should know", { value: v.notes, errors, max: 500, hintText: "Optional. No names, phone numbers, email addresses, or links." })}`;
}
