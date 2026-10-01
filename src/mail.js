// Email and rate limits.
//
// Mail goes through Resend's HTTP API. For local development, set
// MAIL_LOG_ONLY=true in .dev.vars and messages are written to the console
// instead of sent. Without that switch a missing RESEND_API_KEY is an error,
// so a misconfigured deployment never prints manage links to its logs while
// telling people to check their email.

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// Increments a daily counter and returns true if it is still within the limit.
// The increment happens even when the limit is exceeded, which is harmless.
export async function withinLimit(env, key, limit) {
  const row = await env.DB.prepare(
    `INSERT INTO counters (key, day, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key, day) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(key, today())
    .first();
  return row.count <= limit;
}

// Sends one email. Returns true if it was accepted for delivery.
//
// Every email counts against MAIL_DAILY_CAP so the project never depends on
// more than the provider's free allowance. Messages from visitors to hosts
// (kind "message") also count against MAIL_MESSAGE_CAP, which is lower, so
// that a busy day of messages always leaves room for the links hosts need to
// publish and manage their listings.
export async function sendMail(env, { to, subject, text, replyTo, kind = "link" }) {
  const cap = Number(env.MAIL_DAILY_CAP || 90);
  if (kind === "message") {
    const messageCap = Math.min(Number(env.MAIL_MESSAGE_CAP || 60), cap);
    if (!(await withinLimit(env, "mail:message", messageCap))) return false;
  }
  if (!(await withinLimit(env, "mail", cap))) return false;

  if (env.MAIL_LOG_ONLY === "true") {
    console.log(`[mail] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
    return true;
  }
  if (!env.RESEND_API_KEY) {
    console.log("[mail] RESEND_API_KEY is not set; nothing was sent");
    return false;
  }

  const body = { from: env.MAIL_FROM, to: [to], subject, text };
  if (replyTo) body.reply_to = replyTo;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.log(`[mail] provider returned ${res.status}`);
    return res.ok;
  } catch {
    console.log("[mail] provider unreachable");
    return false;
  }
}
