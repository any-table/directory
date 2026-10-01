// Email and rate limits.
//
// Mail goes through Resend's HTTP API. With no RESEND_API_KEY set (local
// development), messages are written to the console instead of sent.

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
// Every message counts against MAIL_DAILY_CAP so the project never depends on
// more than the provider's free allowance.
export async function sendMail(env, { to, subject, text, replyTo }) {
  const cap = Number(env.MAIL_DAILY_CAP || 90);
  if (!(await withinLimit(env, "mail", cap))) return false;

  if (!env.RESEND_API_KEY) {
    console.log(`[mail] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
    return true;
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
