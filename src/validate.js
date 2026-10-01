// Validation for listings and messages. These checks enforce RULES.md.

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const MEALS = {
  potluck: "Potluck: everyone brings something",
  bring: "Bring your own food",
  host: "The host provides the meal",
};

export const CHILDREN = {
  caregivers: "Children welcome with their own caregivers",
  adults: "Adults only",
};

export const REMOVAL_REASONS = {
  charges: "Charges for attendance or asks for money",
  address: "Lists a home address or other private location",
  personal: "Contains someone's personal details",
  impersonation: "Impersonates another person or table",
  spam: "Spam or advertising",
  "not-a-table": "Not a table keeping the gathering",
  unsafe: "Unsafe or unlawful content",
};

// Codes that Intl names but that are not places anyone lives.
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "ZZ"]);

let countryCache = null;
export function countries() {
  if (countryCache) return countryCache;
  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  const list = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (NOT_COUNTRIES.has(code)) continue;
      let name;
      try {
        name = names.of(code);
      } catch {
        name = undefined;
      }
      if (name && name !== code) list.push({ code, name });
    }
  }
  list.sort((x, y) => x.name.localeCompare(y.name, "en"));
  countryCache = list;
  return list;
}

export function countryName(code) {
  const hit = countries().find((c) => c.code === code);
  return hit ? hit.name : code;
}

let zoneCache = null;
export function timezones() {
  if (zoneCache) return zoneCache;
  try {
    zoneCache = Intl.supportedValuesOf("timeZone");
  } catch {
    zoneCache = [];
  }
  return zoneCache;
}

function validTimezone(tz) {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const EMAIL_IN_TEXT = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
const PHONE_IN_TEXT = /\+?\d[\d\s().\-]{7,}\d/;
const URL_IN_TEXT = /(https?:\/\/|www\.)\S+/i;
const STREET_IN_TEXT =
  /\b\d{1,6}\s+[\w.'-]+(\s+[\w.'-]+){0,3}\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|pl|place|terrace|cres|crescent|close)\b\.?/i;

export function isEmail(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value);
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max + 1);
}

// Returns { data, errors }. errors maps field name to a message.
export function validateListing(form, { requireEmail = true } = {}) {
  const errors = {};
  const get = (k) => form.get(k);

  const setting = get("setting") === "home" ? "home" : get("setting") === "public" ? "public" : "";
  const data = {
    setting,
    place: clean(get("place"), 120),
    address: clean(get("address"), 160),
    city: clean(get("city"), 80),
    region: clean(get("region"), 80),
    country: clean(get("country"), 2).toUpperCase(),
    day: clean(get("day"), 12),
    time: clean(get("time"), 5),
    timezone: clean(get("timezone"), 64),
    languages: clean(get("languages"), 60),
    meal: clean(get("meal"), 20),
    children: clean(get("children"), 20),
    accessibility: clean(get("accessibility"), 200),
    notes: clean(get("notes"), 500),
    email: clean(get("email"), 254).toLowerCase(),
  };

  if (!setting) errors.setting = "Choose whether the table meets in a public place or a home.";

  if (data.place.length < 3) errors.place = "Describe where the table meets.";
  else if (data.place.length > 120) errors.place = "Keep this under 120 characters.";

  if (setting === "home") {
    if (data.address) errors.address = "Home tables are listed by area only. Leave the address empty; you share it privately with people who write to you.";
    data.address = "";
    if (STREET_IN_TEXT.test(data.place)) errors.place = "This looks like a street address. For a home table, describe the area instead, such as \"a home in east Springfield.\"";
  } else if (data.address.length > 160) {
    errors.address = "Keep the address under 160 characters.";
  }

  if (!data.city) errors.city = "Enter the city or town.";
  if (!data.region) errors.region = "Enter the state, province, or region.";
  if (!/^[A-Z]{2}$/.test(data.country) || !countries().some((c) => c.code === data.country)) errors.country = "Choose a country.";
  if (!DAYS.includes(data.day)) errors.day = "Choose the day the table meets.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time)) errors.time = "Enter the time as hours and minutes, like 18:30.";
  if (!validTimezone(data.timezone)) errors.timezone = "Choose a time zone from the list, like America/Phoenix.";
  if (!(data.meal in MEALS)) errors.meal = "Choose how the meal works.";
  if (!(data.children in CHILDREN)) errors.children = "Choose whether children may come.";

  for (const field of ["place", "address", "city", "region", "languages", "accessibility", "notes"]) {
    if (errors[field]) continue;
    const v = data[field];
    if (!v) continue;
    if (EMAIL_IN_TEXT.test(v)) errors[field] = "Leave out email addresses. People reach you through the contact form, which keeps your address private.";
    else if (field !== "address" && PHONE_IN_TEXT.test(v)) errors[field] = "Leave out phone numbers. People reach you through the contact form.";
    else if (URL_IN_TEXT.test(v)) errors[field] = "Leave out links.";
  }
  if (!errors.accessibility && data.accessibility.length > 200) errors.accessibility = "Keep this under 200 characters.";
  if (!errors.notes && data.notes.length > 500) errors.notes = "Keep notes under 500 characters.";
  if (!errors.languages && data.languages.length > 60) errors.languages = "Keep this under 60 characters.";

  if (requireEmail && !isEmail(data.email)) errors.email = "Enter an email address where you can receive the link to publish and manage this listing.";

  if (get("rules") !== "yes" && requireEmail) errors.rules = "Confirm that the listing follows the rules.";

  return { data, errors };
}

export function validateMessage(form) {
  const errors = {};
  const data = {
    name: clean(form.get("name"), 80),
    reply: clean(form.get("reply"), 254).toLowerCase(),
    message: (typeof form.get("message") === "string" ? form.get("message") : "").trim().slice(0, 2001),
  };
  if (data.name.length > 80) errors.name = "Keep your name under 80 characters.";
  if (!isEmail(data.reply)) errors.reply = "Enter an email address the host can reply to.";
  if (data.message.length < 10) errors.message = "Write a short message, at least a sentence.";
  else if (data.message.length > 2000) errors.message = "Keep the message under 2,000 characters.";
  return { data, errors };
}
