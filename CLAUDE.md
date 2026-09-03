# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A **template**, not a live site: the reusable starting point for Merki Tech's "Essentials
(static)" package (see `merkitech.com`'s `CLAUDE.md` for the pricing/positioning behind that
tier). It's cloned per client via GitHub's "Use this template" — never branched off directly, and
this repo itself is never the thing that ships. It currently holds placeholder content for a
fictional restaurant ("Aloha Plate Kitchen") as a working example.

When asked to "add a new client" or similar, that means creating a *new* repo from this template,
not editing here. Changes made directly in this repo are template changes that affect every future
clone, so treat them more conservatively than a one-off client edit.

## No build step

`index.html` is the entire site — markup, CSS, and JS all inline, no bundler, no dependencies,
no test suite, no lint config. Preview by opening the file directly or:

```
npx serve .
```

There is nothing to "build" before deploying — the deploy pipeline (see below) pushes the repo's
files as-is. **Exception, added 2026-09-01**: if this client is wired to the Merki Tech portal
(see "Portal-driven content" below), there's now an optional, manually-triggered regeneration
step for the hours/menu sections specifically - still not a build Cloudflare needs to run, just a
GitHub Action that rewrites `index.html` and pushes the result, which Cloudflare then deploys
exactly as it always has.

## Architecture

**Single-file, section-by-section**: `index.html` is one page — hero → About → Menu → Hours/Location
→ Contact → footer. A few sections have non-obvious construction worth knowing before editing:

- **Hero background** is pure CSS (layered `radial-gradient`s) plus an inline SVG wave divider —
  deliberately not a raster image, so it looks finished for any client before a real photo exists
  and needs no image hosting.
- **About section photo** (`.about-photo`) is a hand-authored inline SVG illustration standing in
  for a client photo, themed off the `--primary-1`/`--primary-2` CSS vars so it recolors on a
  reskin. Swap the whole block for a real `<img>` per client.
- **Menu** items carry a `data-category` attribute; `.menu-filter` buttons filter the grid via a
  small JS handler (`menuFilters` click listener) that toggles a `.hidden` class — there's no
  framework here, just attribute-matching.

**Contact form — cross-repo, not self-contained**: the form in this file posts to
`https://www.merkitech.com/relay/submit.php`, a shared PHP endpoint that lives in the sibling
`merkitech.com` repo, not this one. That endpoint looks up the request's `Origin` header against
a `hostname -> {"to": ..., "business": ...}` map in that repo's `relay/clients.json` — an
unregistered origin gets rejected, which is what stops it being an open relay. **Onboarding a new
client's contact form means editing `clients.json` in the `merkitech.com` repo, not this one.**
See that repo's README ("Contact relay for client sites") for why this exists (Cloudflare Email
Routing/Sending were tried first and abandoned — zone-wide MX conflicts, then a paid-plan gate)
and this repo's README checklist for the exact onboarding step. The form also carries a hidden
`_hp` honeypot input — keep it if copying the form markup elsewhere.

**Deployment**: Cloudflare, connected via git push-to-deploy — but as a **Worker with static
assets**, not classic Pages, because Cloudflare's "Connect to Git" flow now defaults there even
though the dashboard still says "Workers & Pages." This matters if you're scripting anything
against the Cloudflare API: use the Workers endpoints
(`/accounts/{account_id}/workers/domains` for custom domains), not the Pages-specific ones, which
return nothing for this kind of deployment. Full deploy steps are in the README.

## Portal-driven content (hours & menu) - opt-in per client

This is the **first real client** of the "portal save → rebuild → bake into static HTML" design
documented in the `merkitech-portal` repo's `CLAUDE.md` (that doc is the canonical source for
*why* it works this way - SEO reasons rule out a client-side `fetch()` at page-load instead; read
it before changing anything here). This section is what an actual clone of this template needs to
know to use or maintain that wiring.

**How it works**: `.github/scripts/rebuild-from-portal.js` fetches this client's `hours`,
`special_hours`, `events`, and `menu` from `public/api/admin.php` on the portal, and rewrites
several things in `index.html` between HTML comment markers (`<!-- PORTAL:...:START/END -->`):
- The JSON-LD `openingHoursSpecification` (inside the `PORTAL:JSONLD` markers - the whole
  `<script type="application/ld+json">` tag gets parsed as JSON, that one field replaced, and
  rewritten whole, so other JSON-LD fields like `name`/`address`/`telephone` stay exactly as
  hand-edited).
- The visible hours table (`PORTAL:HOURS-TABLE`) - one row per day, not grouped ("Mon–Fri" style)
  even when several days share identical hours. Simpler and always correct; revisit only if the
  extra table height genuinely bothers a client. Each `<tr>` carries a `data-day="mon"`-style
  attribute (added 2026-09-03) purely for the two JS behaviors below - not used by the rebuild
  script itself once the row is built.
- **Per-day location** (`hours[day].location_name`/`location_address`/`location_maps_url`,
  resolved server-side from the portal's `locations` table via `hours.location_id` - see
  `merkitech-portal/CLAUDE.md`'s "Locations entity, location_mode, and the General settings page"
  section for the full design, which superseded the original 2026-09-03 freeform-string version),
  shown one line behind that day's hours in the same table cell, not a separate section - a food
  truck's day-by-day spot is really just another per-day field alongside open/close time, and this
  is what "align them in the UI... one line behind the day/opening hour" (the actual ask) meant
  literally. Rendered as a clickable link (`buildLocationLink()`) - an exact `maps_url` if the
  owner pinned one, else a Maps search of the address, else of the name (same fallback chain an
  event's own location link uses, both now built through the shared `mapsSearchUrl()` helper).
  **Only rendered at all when `client.location_mode === 'per_day'`** (`buildHoursTableRows()`
  checks this, not just the `locations` feature flag) - a client in `'default'` mode shows their
  one location in the right-hand Location column instead (see below), so repeating it on every row
  would be redundant even if some rows still carry old `location_id` data from before a mode
  switch. **Not fed into JSON-LD** - schema.org has no clean way to express "a different address
  per weekday" on one `Restaurant`/`FoodEstablishment` entity without modeling several separate
  `LocalBusiness` entries, which felt like a disproportionate SEO investment for a feature with no
  real client on it yet. Revisit if a real food-truck client actually wants this indexed.
- **Today's row, and this week's special-hours highlight** - a small inline script
  (`markTodayAndUpcomingSpecialHours()`, renamed 2026-09-04 from
  `highlightUpcomingSpecialHours()`) does two independent things to the regular-hours table:
  - Adds a `.today` class (bold, coral day name) to whichever row matches the visitor's own local
    weekday - unconditional, regardless of whether that day also has special hours coming up.
  - For any weekday with a special-hours entry landing in the next 7 days, appends a **clickable**
    `<button class="special-hours-soon-badge">` ("Special hours – in N days") behind that day's
    name - clicking it scrolls the matching row in the "Upcoming hours changes" table into view
    and briefly flashes it (`.flash-highlight`, removed after ~1.6s), so the badge actually takes
    you somewhere instead of just announcing a fact you'd have to go find yourself. Changed
    2026-09-04 from a plain non-interactive `<span>`, and the day *name* itself no longer gets
    bolded/colored just for having a badge (that emphasis moved to `.today` above, since bolding
    both today and every upcoming-special-hours day read as two different things fighting for the
    same visual weight).
  - **Has to run client-side** - a static page baked once at rebuild time can't know "today" until
    the visitor's own browser loads it, unlike everything else in this section, which is baked in
    ahead of time on purpose for crawlers. The badge-matching half keys off `data-day` (not by
    re-deriving a weekday from a date in the browser) - the special-hours `<tr>` gets both
    `data-date` and a `data-day` computed server-side in `dayOfWeekSlug()` (UTC-safe, same
    reasoning as `formatSpecialDate()` just above it - avoids a real off-by-one risk from parsing a
    bare `"2026-09-07"` string as a JS `Date`, which is UTC midnight and can print as the day
    before west of UTC). The runtime day-count itself (`daysFromToday()`) still has to run in the
    visitor's browser, but does so by comparing plain calendar-date components through
    `Date.UTC()`, not by trusting `new Date(dateString)`'s own parsing - so it can't drift a day
    depending on the visitor's timezone either. Today's own row, by contrast, is intentionally
    computed from the *local* `new Date().getDay()` - "today" should mean the visitor's own
    calendar day, not a UTC one.
- **The right-hand "Location"/"Find Us" column is portal-driven and mode-aware, and for a
  `'per_day'` client is omitted entirely rather than shown** - `PORTAL:LOCATION-COLUMN` (renamed
  2026-09-04 from `PORTAL:LOCATION-BLOCK`, and now wrapping the whole `<div>` column, not just its
  inner text - see the marker comment in `index.html`) is emitted by `buildLocationColumn()`:
  - **`'per_day'`** (a client with the `locations` feature on, in per-day mode): returns an empty
    string, dropping the entire second grid column - changed 2026-09-04 from the original
    2026-09-03 design, which instead showed a "Find Us" pointer panel there. Reasoning: that
    client's own per-day location links (`buildLocationLink()`, one behind each day's hours in the
    column to the *left*) already say where they are each day, so a second, generic "check the
    schedule" panel read as a redundant middleman once it sat right next to the real schedule. With
    the column gone, `.info-grid` (a `repeat(auto-fit, minmax(280px, 1fr))` grid) naturally
    stretches its one remaining child - the hours column - to the row's full width; no separate
    "single column" class or breakpoint override needed, that's just how `auto-fit` collapses an
    empty track.
  - **Every other case** (feature off, or on but `'default'` mode) still renders the column, via
    `buildLocationBlock()` for its inner content: `clients.address`/`clients.phone` (added
    2026-09-03) back the plain fallback; `'default'` mode instead shows the *one* location picked
    on `general.php` from the client's saved `locations`, resolved server-side onto the `client`
    API resource as `default_location` (`{name, address, maps_url}`) and rendered as a clickable
    heading (name linking to `maps_url`, or a Maps search of the address/name if no exact link was
    set) plus its address line. Falls through to the plain address/phone fallback if `'default'`
    mode has nothing picked yet (e.g. a brand-new client who hasn't visited `general.php`), so this
    never renders an empty panel.
  - **`telephone` in the JSON-LD `Restaurant` object is synced from the portal too** (a plain
    string, safe to overwrite exactly) - **`address` in JSON-LD is deliberately left
    hand-edited**, not synced from `clients.address` or a default location's address: schema.org's
    structured `PostalAddress` needs street/city/state/zip broken out, and the portal only stores
    freeform address strings - decomposing one reliably in code risked silently corrupting real
    structured data, which was judged worse than accepting a small drift-able gap between the
    visible address and the structured one. Revisit only if that drift turns out to matter in
    practice.
- **`.hours-location` renders inline, behind the hours text, not below it, fixed 2026-09-04** - the
  original CSS used `display: block`, which put it on its own line *underneath* the hours text
  despite this same doc (and the CSS comment next to it) already describing it as "one line
  behind" - a real mismatch between the documented intent and the actual rule, caught when asked to
  make it visually sit "behind instead of below." Now a plain inline element (`white-space: nowrap`
  so the pin emoji and location name never split across a wrap) that flows right after the hours
  text in the same table cell, wrapping onto a second line as a whole unit only if the combined
  text doesn't fit the cell's width.
- **Today's row weight toned down, `'today'` cells lightened from 700 to 600, 2026-09-04** - full
  bold on just the day name read as visually equal to the "Upcoming hours changes" `<h4>` heading
  directly below it, competing with it instead of reading as a lighter in-table cue. Rebalanced:
  the day name (first cell) dropped to `font-weight: 600`, and the actual opening-hours text (last
  cell) - previously unstyled beyond the table's own muted `#666` - now also gets `font-weight: 600`
  plus the normal (non-muted) text color, so "today" reads as emphasis on the information that
  actually matters (today's hours), not a shouted label.
- **Special hours** (holiday closures, one-off event hours), added 2026-09-02 - two things, both
  from the `special_hours` API resource (which only ever returns `date >= today`, so a stale
  closure from last month never lingers anywhere):
  - `specialOpeningHoursSpecification` in the same JSON-LD block, one entry per date
    (`validFrom`/`validThrough` both set to that date). Baked into static HTML at rebuild time
    like everything else here, not fetched client-side, for the same SEO reasoning - and unlike a
    human reading the page, a crawler gets no benefit from hiding a change that's more than a
    week or two out, so every future-dated entry the API returns goes in with no extra cutoff
    applied here.
  - A visible "Upcoming hours changes" block (`PORTAL:SPECIAL-HOURS` markers, right after the
    regular hours table) - the *entire* section, heading included, is emitted only when there's
    at least one upcoming entry and is empty otherwise, so a client with nothing special coming
    up never shows a heading with nothing under it.
- **Events** (a market stand, a pop-up - see `merkitech-portal/CLAUDE.md`'s "Per-client feature
  flags" section for why this is opt-in, not every client's site), added 2026-09-02 - only present
  at all for a client with the "events" feature enabled and at least one upcoming entry:
  - A **separate, second** `<script type="application/ld+json">` block
    (`PORTAL:EVENTS-JSONLD` markers, right after the Restaurant one) - one `"@type": "Event"`
    object per event, each with `name`/`startDate`/`eventAttendanceMode`/`eventStatus` always
    present and `endDate`/`description`/`location`/`url` only when that field was actually filled
    in on the portal. Deliberately its own top-level object rather than a property nested inside
    the Restaurant JSON-LD above - Google's Event rich result looks for a top-level `Event` type,
    not something nested. `startDate`/`endDate` are built as full ISO 8601 datetimes with a
    hardcoded `-10:00` (Hawaii Standard Time, no DST) offset - fine for this product's Hawaii-only
    client base, but revisit `HAWAII_UTC_OFFSET` in the rebuild script if that ever changes.
    Google's minimum for rich-result eligibility is name/startDate/location - an event with no
    location still gets a (valid, just not rich-result-eligible) `Event` object rather than being
    dropped, since the location can always be filled in later.
  - A visible "Upcoming Events" section (`PORTAL:EVENTS-SECTION` markers, its own `<section>`
    between Hours & Location and Contact, not nested inside either) - same "whole block, heading
    included, absent if there's nothing to show" pattern as special hours. Each event card shows
    only the fields that were actually filled in (no location line for an event with none, no
    "More info" link for one with no `link_url`) rather than rendering an empty placeholder line.
  - The static nav (`#about`/`#menu`/`#info`/`#contact`) does **not** get an `#events` link added
    automatically - a deliberate simplification, not an oversight, since not every clone has the
    feature on. The section is always reachable (an anchor exists, `id="events"`) and visible in
    normal scroll order regardless. **This demo's own nav does have the `#events` link** (added
    2026-09-02, right after "Hours & Location"), since the demo is exactly the "real client using
    this feature" case the note above was waiting for - remove it by hand in a clone that doesn't
    enable Events, don't leave a dead nav link pointing at a section that never renders.
- **A client can have menu data disabled entirely** (`clients.menu_enabled`, on by default - see
  `merkitech-portal/CLAUDE.md`'s "Client tiers, the detail page, and menu as an opt-out toggle"
  section, added 2026-09-02). When it's off, `resource=menu` returns `[]`, so the rebuild
  script correctly empties the filter pills and grid - **but the "Our Menu" `<h2>` and section
  wrapper in `index.html` are static markup, not conditionally emitted like the Events section
  is**, so today this leaves a heading over an empty grid rather than hiding the section outright.
  Not fixed yet - would need the same whole-section-emission pattern Events uses (see
  `PORTAL:EVENTS-SECTION` below) applied to Menu too.
- **The menu filter pills and grid items together** (`PORTAL:MENU-FILTERS` / `PORTAL:MENU-GRID`) -
  regenerated from the portal's actual category list, not a fixed set. A category's name becomes
  both the filter pill's label and the `data-filter`/`data-category` slug (lowercased,
  non-alphanumeric → `-`), so **the categories, and which items are hidden as sold-out
  (`is_available = 0`), are maintained entirely from the portal now** - don't hand-edit a
  category name or the filter/item pairing directly in `index.html` for a portal-wired client,
  it'll be overwritten on the next rebuild and the portal is the actual source of truth.
  **An item can belong to more than one category** in the portal (e.g. "Bestsellers" and
  "Mains") - the rebuild script emits one card per item regardless, with every category it
  belongs to folded into one space-separated `data-category` (`"bestsellers mains"`), and the
  filter click-handler JS checks *membership* in that space-separated list rather than exact
  string equality against the whole attribute - don't revert that check to `===` if touching the
  filter JS, it'll silently break multi-category items.
  **The unfiltered "All" view is grouped under `<h3 class="menu-category-heading">` labels**,
  added 2026-09-02 after testing with a 32-item/7-category menu made "All" read as one
  undifferentiated wall of cards with no sense of menu section. A multi-category item still gets
  exactly one card (never duplicated - see the paragraph above), grouped under whichever of its
  categories the portal lists first; its `data-category` still carries every category it belongs
  to, so filtering to any of them still finds it. Headings are hidden by `menuFilters`' click
  handler the moment a specific category is picked (the active pill already says which section
  you're looking at), and reappear when "All" is re-selected. Item names moved down from `<h3>`
  to `<h4>` to make room for the category heading one level up in the hierarchy - keep that
  order (h2 section title → h3 category heading → h4 item name) if touching this markup again.
  **The unfiltered "All" view collapses to a preview with a "Show Full Menu" button**, added
  2026-09-02 once the same 32-item/7-category demo menu was measured pushing Hours & Location
  ~8000px down the page on mobile - a real scroll-depth complaint, not a hypothetical one.
  Pagination was considered and rejected (unfamiliar pattern for a food menu; people expect to
  scroll or filter, not page through). Instead, `index.html`'s inline script only applies the
  collapse when there are 16+ total items, cutting on whole-category boundaries only (walks
  category segments accumulating item counts, stops adding once ~10 items are reached, hides
  every segment after that point) - **never mid-category**, so a shown category is never missing
  items with no indication of it. Picking any specific filter pill (not "All") always shows every
  matching item regardless of the preview cutoff - the whole point is a shorter *default* view,
  not permanently hiding content behind a filter. Clicking "Show Full Menu" removes the button and
  reveals the rest for the remainder of that page view (no re-collapse on returning to "All").
  **No SEO impact**: every item is still present in the static HTML the crawler receives either
  way, exactly like the category headings above - this purely toggles a `display:none` class
  (`.menu-preview-hidden`, kept separate from the filter's own `.hidden` class so the two don't
  clobber each other) after the page has already loaded with everything in the DOM. The button
  markup (`#menuShowMore`) lives in `index.html` *outside* the `PORTAL:MENU-GRID` markers on
  purpose, so a rebuild never touches it even though it's the last thing inside `.menu-grid`.

**Never hand-edit content between any `PORTAL:...` marker pair for a client wired this way** -
change it in the portal (`hours.php`/`special-hour-edit.php`/`categories.php`/`items.php`) and
rebuild instead. Everything *outside* the markers (colors, About section, contact info text, hero
copy) is still exactly the same hand-edited static HTML as any other clone.

**Triggering a rebuild**: manual (GitHub → Actions → "Rebuild from portal" → Run workflow) always
works. It also fires automatically right after a save in the portal, via a `repository_dispatch`
event this workflow listens for (`merkitech-portal/CLAUDE.md`'s "automatic rebuild trigger"
section has the token/permission this needs on the portal side) - confirmed working end-to-end
2026-09-01. If a future clone's `github_repo` isn't set on the portal side, or its token is
missing/wrong, it silently falls back to manual-only - the same workflow file supports both with
no changes needed here either way.

**Concurrent runs cancel the older one, added 2026-09-02**: several saves in quick succession
(reordering a whole menu list one drag at a time fires one `repository_dispatch` per drop) used to
mean several overlapping runs, and two of them racing on the final `git push` step is a real
failure hit the same day - one run's push gets rejected because the other already landed first.
The workflow's `concurrency: { group: rebuild-from-portal, cancel-in-progress: true }` fixes this
by cancelling whatever older run is still going the moment a newer one starts, so only the most
up-to-date save ever reaches the commit/push step. This was deliberately *not* solved with a
delay/debounce (wait N seconds, batch pending saves) instead - that needs somewhere to persist
"a rebuild is pending" plus a cron job to fire it later (this host has no background worker), for
a benefit that's mostly saving GitHub Actions minutes, which isn't scarce at this volume - and it
would make "did my change go live" noticeably less immediate to verify than it is today.

**Portal data is fetched sequentially, not via `Promise.all`, added 2026-09-02**: adding `events`
as a fourth concurrent request (hours/special_hours/menu were the original three) started
intermittently tripping the host's bot-check - see the `BROWSER_UA` comment above - where three
never did, a real failure hit the same day (a different one of the four resources failed each
retry, confirming it was a burst/rate thing, not a broken resource). `fetchPortal()` now also
retries once or twice on a bad-JSON response as a second line of defense against the same
interstitial. If a fifth portal resource is ever added here, don't reach for `Promise.all` again
without checking whether this host's rate limiting has room for it.

**Pipeline-failure email audit (2026-09-02)**: user reported getting failure-notification emails
"quite often." Pulled the last 100 workflow runs via `gh run list` and matched every failure's
timestamp against when the two fixes above actually landed - every single organic failure (the
`fetch first` push races, and the bot-check `SyntaxError` ones) predates its respective fix; zero
organic failures since. The one failure found *after* both fixes landed was self-inflicted: a
deliberate ~30-runs-in-one-minute stress test (proving `cancel-in-progress` actually cancels) that
burned through the bot-check retry's 3 attempts. Real client edits don't fire that fast, but the
retry was bumped 3→5 attempts with longer backoff (1000ms×attempt, was 750ms×attempt) anyway since
the headroom is free. Also worth checking on the user's end: GitHub's default notification setting
only emails on failure, not cancellation - since `cancel-in-progress` now produces a cancelled run
on every burst of rapid saves (30 of the reviewed 100 runs were cancelled, all from one intentional
test), confirm that setting is still "failure only" at github.com/settings/notifications if the
email volume doesn't drop after this.

**Per-clone secrets required** (repo Settings → Secrets → Actions), because each client-site
clone points at a *different* portal client:
| Secret | Value |
|---|---|
| `PORTAL_URL` | `https://portal.merkitech.com` |
| `PORTAL_API_TOKEN` | **a scoped token for this client, not the portal's admin token - see below** |
| `PORTAL_CLIENT_ID` | this client's numeric id in the portal |

**`PORTAL_API_TOKEN` is a scoped, per-client token, fixed 2026-09-02** (was the portal's
all-powerful admin token until then - a real tradeoff, since a leak in any one client-site repo
would have compromised every other client's data too, not just its own). Generate one per client
from the portal's admin screen (`admin.php`, the 🔑 row action next to that client - see
`merkitech-portal/CLAUDE.md`'s "Site rebuild wiring" section for exactly what it can and can't
do) and paste it into that repo's `PORTAL_API_TOKEN` secret. **This demo (client id 5) was
migrated onto its own generated token the same day** - confirmed working end-to-end (a fresh
`workflow_dispatch` rebuild succeeded and the live site updated correctly) rather than left as a
theoretical fix. Regenerating a client's token from the portal instantly invalidates the old one,
so update the secret here immediately after regenerating, not before - a delay just means the
next automatic or manual rebuild fails until it's updated. **Never reuse the portal's admin
token (the one Claude/tooling uses) for a client-site repo's `PORTAL_API_TOKEN` again** - that
was the exact shortcut this fix closed.

## Before shipping a client copy

The README's "Customization checklist" is the authoritative list (title/meta, JSON-LD, logo/hero
copy, About copy + photo, menu items/categories, hours/location, contact-form client registration,
brand colors via the `:root` CSS vars, favicon, `robots.txt`/`sitemap.xml`, and removing this
README if the client will see the repo) — don't duplicate it here, just don't skip it.
