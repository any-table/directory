// Security helpers. No third-party code: Web Crypto only.

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0, 1

export function randomId(length = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// A manage token is 256 random bits. Only its hash is stored.
export function newToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cloudflare Turnstile. Disabled only when TURNSTILE_DISABLED is "true",
// which is set in .dev.vars for local development and never in production.
export function turnstileEnabled(env) {
  return env.TURNSTILE_DISABLED !== "true";
}

export async function verifyTurnstile(env, token, ip) {
  if (!turnstileEnabled(env)) return true;
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// Every POST must come from our own pages. This blocks cross-site form
// submissions, including against the admin page, which relies on a cookie.
export function sameOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const allowed = new URL(env.SITE_URL).origin;
  const self = new URL(request.url).origin;
  return origin === allowed || origin === self;
}

// Cloudflare Access puts a signed JWT on every request to a protected path.
// We verify it ourselves so the admin page is safe even if the Access policy
// is misconfigured or the Worker is reached another way.
let jwksCache = { at: 0, keys: [] };

async function accessKeys(team) {
  if (Date.now() - jwksCache.at < 3600_000 && jwksCache.keys.length) return jwksCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) return [];
  const { keys } = await res.json();
  jwksCache = { at: Date.now(), keys: keys || [] };
  return jwksCache.keys;
}

export async function verifyAccess(request, env) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!team || !aud) return null;
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
    if (header.alg !== "RS256") return null;
    const jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64urlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    if (payload.iss !== `https://${team}`) return null;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(aud)) return null;
    return { email: payload.email || "custodian" };
  } catch {
    return null;
  }
}
