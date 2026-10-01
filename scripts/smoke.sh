#!/usr/bin/env bash
# End-to-end check against a local `wrangler dev` (see README).
# Mail is printed to the dev server's log instead of sent; pass that log's path.
# Expects the low mail caps that scripts/test.sh sets (MAIL_DAILY_CAP=8,
# MAIL_MESSAGE_CAP=2) so the last section can reach them.
set -euo pipefail
BASE="${BASE:-http://localhost:8787}"
LOG="${1:?usage: scripts/smoke.sh path/to/dev.log}"
O=(-H "Origin: $BASE")
pass=0; fail=0
ok()   { echo "  ok   $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL $1"; fail=$((fail+1)); }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
has()  { curl -s "$@" ; }
check_code() { local want="$1" label="$2"; shift 2; local got; got=$(code "$@"); [[ "$got" == "$want" ]] && ok "$label ($got)" || bad "$label (got $got, want $want)"; }
check_has()  { local needle="$1" label="$2"; shift 2; local body; body=$(has "$@"); grep -qF -- "$needle" <<<"$body" && ok "$label" || bad "$label"; }
last_link()  { grep -oE "$BASE/(confirm|manage)\?id=[a-z2-9]{10}&t=[A-Za-z0-9_-]+" "$LOG" | tail -1; }

LISTING=(--data-urlencode setting=public --data-urlencode "place=Springfield Public Library, room 2"
  --data-urlencode "address=123 Main St" --data-urlencode city=Springfield --data-urlencode region=Arizona
  --data-urlencode country=US --data-urlencode day=Tuesday --data-urlencode time=18:30
  --data-urlencode timezone=America/Phoenix --data-urlencode meal=potluck --data-urlencode children=caregivers)

echo "pages"
check_code 200 "home" "$BASE/"
check_has "No tables are listed yet" "empty state" "$BASE/"
check_code 200 "add form" "$BASE/add"
check_code 200 "rules" "$BASE/rules"
check_code 200 "privacy" "$BASE/privacy"
check_code 404 "unknown page" "$BASE/nope"
check_code 404 "admin without Access" "$BASE/admin"
check_code 200 "stylesheet" "$BASE/style.css"

echo "validation"
check_code 403 "cross-site post rejected" -X POST -H "Origin: https://evil.example" "${LISTING[@]}" "$BASE/add"
check_has "Confirm that the listing follows the rules" "rules box required" "${O[@]}" "${LISTING[@]}" --data-urlencode email=host@example.com "$BASE/add"
check_has "Home tables are listed by area only" "home table with address rejected" "${O[@]}" \
  --data-urlencode setting=home --data-urlencode "place=a home in east Springfield" --data-urlencode "address=9 Elm St" \
  --data-urlencode city=Springfield --data-urlencode region=Arizona --data-urlencode country=US --data-urlencode day=Friday \
  --data-urlencode time=19:00 --data-urlencode timezone=America/Phoenix --data-urlencode meal=bring \
  --data-urlencode children=adults --data-urlencode email=h@example.com --data-urlencode rules=yes "$BASE/add"
check_has "This looks like a street address" "street address in a home place rejected" "${O[@]}" \
  --data-urlencode setting=home --data-urlencode "place=42 Oak Avenue" \
  --data-urlencode city=Springfield --data-urlencode region=Arizona --data-urlencode country=US --data-urlencode day=Friday \
  --data-urlencode time=19:00 --data-urlencode timezone=America/Phoenix --data-urlencode meal=bring \
  --data-urlencode children=adults --data-urlencode email=h@example.com --data-urlencode rules=yes "$BASE/add"
check_has "Leave out email addresses" "email in notes rejected" "${O[@]}" "${LISTING[@]}" \
  --data-urlencode "notes=write to me at me@example.com" --data-urlencode email=host@example.com --data-urlencode rules=yes "$BASE/add"
check_has "Leave out phone numbers" "phone in notes rejected" "${O[@]}" "${LISTING[@]}" \
  --data-urlencode "notes=call 555 123 4567" --data-urlencode email=host@example.com --data-urlencode rules=yes "$BASE/add"
check_has "Choose a time zone" "bad time zone rejected" "${O[@]}" "${LISTING[@]/America\/Phoenix/Mars/Olympus}" \
  --data-urlencode email=host@example.com --data-urlencode rules=yes "$BASE/add"

echo "add and publish"
check_code 303 "valid listing accepted" "${O[@]}" "${LISTING[@]}" --data-urlencode email=Host@Example.com --data-urlencode rules=yes "$BASE/add"
sleep 1
LINK=$(last_link); ID=$(sed -E 's/.*id=([a-z2-9]+).*/\1/' <<<"$LINK"); TOK=$(sed -E 's/.*t=//' <<<"$LINK")
[[ "$LINK" == *"/confirm?"* ]] && ok "confirmation email sent" || bad "confirmation email sent"
check_code 404 "pending listing not public" "$BASE/t/$ID"
check_has "Publish your table" "confirm page shows preview" "$LINK"
check_code 404 "confirm with wrong token" "$BASE/confirm?id=$ID&t=wrongwrongwrongwrongwrong"
check_code 303 "publish" "${O[@]}" --data-urlencode id="$ID" --data-urlencode t="$TOK" "$BASE/confirm"
check_code 200 "listing public" "$BASE/t/$ID"
check_has "Tables in United States" "country page" "$BASE/in/US"
check_has "123 Main St" "public address shown" "$BASE/t/$ID"
PAGE=$(has "$BASE/t/$ID"); grep -qi "host@example.com" <<<"$PAGE" && bad "email hidden on public page" || ok "email hidden on public page"

echo "manage"
check_has "Manage your table" "manage page" "$BASE/manage?id=$ID&t=$TOK"
check_code 303 "edit saved" "${O[@]}" --data-urlencode id="$ID" --data-urlencode t="$TOK" --data-urlencode action=update \
  "${LISTING[@]/room 2/room 3}" "$BASE/manage"
check_has "room 3" "edit visible to host" "$BASE/manage?id=$ID&t=$TOK"
check_code 303 "still meeting" "${O[@]}" --data-urlencode id="$ID" --data-urlencode t="$TOK" --data-urlencode action=confirm "$BASE/manage"

echo "contact"
check_has "Enter an email address the host can reply to" "message needs reply address" "${O[@]}" \
  --data-urlencode "message=Hello, I'd like to come on Tuesday." "$BASE/t/$ID/contact"
check_code 303 "message sent" "${O[@]}" --data-urlencode name=Visitor --data-urlencode reply=visitor@example.com \
  --data-urlencode "message=Hello, I'd like to come on Tuesday." "$BASE/t/$ID/contact"
sleep 1
grep -q "to=host@example.com subject=\"A message about your table" "$LOG" && ok "message relayed to host" || bad "message relayed to host"

echo "lost link"
check_code 303 "lost link request" "${O[@]}" --data-urlencode email=host@example.com "$BASE/lost"
sleep 1
NEW=$(last_link); NEWTOK=$(sed -E 's/.*t=//' <<<"$NEW")
[[ "$NEWTOK" != "$TOK" ]] && ok "new token issued" || bad "new token issued"
check_code 404 "old link stops working" "$BASE/manage?id=$ID&t=$TOK"
check_code 200 "new link works" "$NEW"
check_code 303 "unknown address gets the same answer" "${O[@]}" --data-urlencode email=nobody@example.com "$BASE/lost"

echo "export"
check_has "\"id\": \"$ID\"" "listing in export" "$BASE/data/tables.json?fresh=$RANDOM"
EXPORT=$(has "$BASE/data/tables.json?fresh=$RANDOM"); grep -q "example.com" <<<"$EXPORT" && bad "no emails in export" || ok "no emails in export"

echo "daily job"
check_code 200 "scheduled handler runs" "$BASE/__scheduled?cron=23+4+*+*+*"

echo "remove"
check_code 200 "remove without the box re-shows the page" "${O[@]}" --data-urlencode id="$ID" --data-urlencode t="$NEWTOK" --data-urlencode action=remove "$BASE/manage"
check_code 200 "listing still there" "$NEW"
check_has "Removed" "removed" "${O[@]}" --data-urlencode id="$ID" --data-urlencode t="$NEWTOK" --data-urlencode action=remove --data-urlencode sure=yes "$BASE/manage"
check_code 404 "manage link dead after removal" "$NEW"

echo "mail limits"
# Three emails have gone out so far: one publish link, one message, one new link.
add_as() { curl -s -o /dev/null -w '%{http_code}' "${O[@]}" "${LISTING[@]}" --data-urlencode email="$1" --data-urlencode rules=yes "$BASE/add"; }
[[ "$(add_as second@example.com)" == 303 ]] && ok "second listing accepted (mail 4)" || bad "second listing accepted (mail 4)"
sleep 1
LINK2=$(last_link); ID2=$(sed -E 's/.*id=([a-z2-9]+).*/\1/' <<<"$LINK2"); TOK2=$(sed -E 's/.*t=//' <<<"$LINK2")
check_code 303 "second listing published" "${O[@]}" --data-urlencode id="$ID2" --data-urlencode t="$TOK2" "$BASE/confirm"
MANAGE2="$BASE/manage?id=$ID2&t=$TOK2"
MSG=(--data-urlencode reply=visitor@example.com --data-urlencode "message=Hello, I'd like to come on Tuesday.")
check_code 303 "second message sent (mail 5, message 2 of 2)" "${O[@]}" "${MSG[@]}" "$BASE/t/$ID2/contact"
check_has "be sent right now" "third message refused by MAIL_MESSAGE_CAP" "${O[@]}" "${MSG[@]}" "$BASE/t/$ID2/contact"
for n in 3 4 5; do
  [[ "$(add_as "host$n@example.com")" == 303 ]] && ok "listing $n accepted (mail $((n + 3)))" || bad "listing $n accepted (mail $((n + 3)))"
done
check_has "nothing was saved" "listing refused at MAIL_DAILY_CAP" "${O[@]}" "${LISTING[@]}" --data-urlencode email=host6@example.com --data-urlencode rules=yes "$BASE/add"
check_code 303 "lost link request at the cap" "${O[@]}" --data-urlencode email=second@example.com "$BASE/lost"
check_code 200 "link still works when the new one couldn't be sent" "$MANAGE2"
npx wrangler d1 execute anytable-directory --local \
  --command "UPDATE listings SET confirmed_at = '$(date -u -d '200 days ago' +%Y-%m-%dT%H:%M:%S.000Z)' WHERE id = '$ID2'" > /dev/null 2>&1
check_code 200 "daily job at the cap" "$BASE/__scheduled?cron=23+4+*+*+*"
check_code 404 "unconfirmed listing hidden" "$BASE/t/$ID2?fresh=$RANDOM"
check_has "Hidden." "link still works when the hidden notice couldn't be sent" "$MANAGE2"

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
