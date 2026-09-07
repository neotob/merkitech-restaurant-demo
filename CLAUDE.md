# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A **live demo**, not a template and not a real client site: created 2026-09-04 by cloning
`neotob/merkitech-essentials-starter` ("Use this template") specifically to be the *sit-down
restaurant* counterpart to that repo's own demo (`demo.merkitech.com`, a food truck - "Aloha Plate
Kitchen"). See `merkitech-essentials-starter/CLAUDE.md` for every piece of shared technical design
(the `PORTAL:...` marker system, `.github/scripts/rebuild-from-portal.js`, the bot-check/retry
history, Cloudflare deploy quirks, the customization checklist) - none of that is duplicated here
on purpose, to avoid two copies of the same explanation drifting apart. This file only covers what's
actually specific to *this* clone.

**Shared logic can silently drift out of sync - it already did once.** Because this is an
independent clone, not a symlink or shared package, a bug fix or feature landing in
`merkitech-essentials-starter`'s `.github/scripts/rebuild-from-portal.js` (or the matching
structural markup in its `index.html`) does **not** automatically reach this repo. That happened
for real on 2026-09-04: this repo was still on the pre-fix single-date special-hours model and the
pre-fix separate MENU-FILTERS/MENU-GRID markers (instead of one combined MENU-SECTION) for about a
day after the template moved on, until both were manually ported over in the same session that
built this note. When picking up template-side work, check whether this repo (and
`merkitech-essentials-starter` itself, which is also `demo.merkitech.com`) needs the same change
ported - there's no automated mechanism that does this for you.

**Why a second demo exists**: `merkitech-portal`'s "Locations" feature (see that repo's
`CLAUDE.md`, "Locations entity, location_mode, and the General settings page") has two real modes -
`'per_day'` (a different location each day, what the food-truck demo exercises) and `'default'`
(one fixed location, picked from the saved Locations list). Client 5 (the food-truck demo) only
ever exercises `'per_day'` - the `'default'` branch, along with a closed day and a menu small
enough to skip the "Show Full Menu" collapse, had zero live test coverage before this demo existed.

## Identity - "Hale Kai Restaurant (Demo)"

- **Portal client id 8**, tier `portal`, `enabled_features = locations,languages` (no `events` -
  this demo is deliberately the *other* direction from client 5, which already covers events/
  per-day locations). **`languages = 'es,ja'`, activated 2026-09-04** (portal migration 026) so
  this demo also proves out multi-language phase 2 live - `restaurant-demo.merkitech.com/es/` and
  `/ja/` are real generated pages, not a hypothetical. Activated via a one-time data-seeding
  migration rather than the portal's own admin UI (no browser session was available in the
  environment that built this) - see that migration's own comment and
  `merkitech-portal/CLAUDE.md`'s multi-language sections. Menu item/category translations were
  filled in the same day (see "Activated for real on this demo" below) - stale note removed
  2026-09-05, this used to say they hadn't been yet.
- **`location_mode = 'default'`**, with one saved `locations` row ("Hale Kai Restaurant", 456
  Plumeria Lane, Kapolei HI 96707) set as `default_location_id` - picked with a `maps_url` on
  `maps.google.com` (deliberately a different host than the auto-generated
  `www.google.com/maps/search` fallback) so it's visually obvious on the live site that the exact
  link is what's rendered, not a computed fallback.
- **Hours**: closed Monday, dinner-only Tue-Sun (17:00-21:00/22:00, Sunday 16:00-20:00) - the only
  client in this product with a closed day at all, so the portal's `.hours-times` hide-when-closed
  CSS and the public site's "Closed" row/JSON-LD-omission logic both get real coverage here.
- **Menu**: 3 categories (Starters, Entrees, Desserts), 13 items total - under the 16-item
  threshold that triggers `index.html`'s "Show Full Menu" collapse (see
  `merkitech-essentials-starter/CLAUDE.md`), so this demo is what confirms that collapse correctly
  *doesn't* engage for a normal-sized menu, the way client 5's 32-item menu confirms it does.
- **No special hours, no events** - both already have real coverage on client 5; adding them here
  too would just duplicate that coverage without testing anything new.

## Repo-specific setup

- **`PORTAL_URL`/`PORTAL_API_TOKEN`/`PORTAL_CLIENT_ID`** secrets are set to client id 8's own
  scoped token (see `merkitech-essentials-starter/CLAUDE.md`'s "Per-clone secrets required" for
  what these do and why the token is scoped, not the portal's admin token).
- **Domain**: `restaurant-demo.merkitech.com`, wired the same way `demo.merkitech.com` was (see
  `merkitech.com/CLAUDE.md`'s "Cloudflare API access" section for the Workers-with-static-assets
  gotcha and the exact API calls) - Cloudflare's "Connect to Git" step itself is unavoidably manual
  (an OAuth/GitHub-App click-through), everything after it (custom domain) is API-driven.
- **`<title>`/meta/JSON-LD/hero/About copy** were hand-edited for the Hale Kai identity when this
  repo was created; hours/menu/location are portal-managed from client id 8 onward, same "don't
  hand-edit between PORTAL markers" rule as the food-truck demo.
- **`robots.txt`/`sitemap.xml`/`<link rel="canonical">` were deliberately left as the
  `example.com` placeholder**, matching `merkitech-essentials-starter`'s own demo (which never
  updated these either) - neither demo is meant to be indexed for real, so fixing one and not the
  other would just be an inconsistency with no real benefit.

## Multi-language, phase 2 (site build), ported 2026-09-04

`merkitech-essentials-starter/CLAUDE.md`'s own "Multi-language, phase 2" section is the canonical
source for the full design (why chrome text uses `[data-i18n]` + `i18n/*.json` while menu/category
translations come from the portal API's own `translations` field, why the primary/root file is
never touched by any of that, the hreflang/canonical/language-switcher mechanics, and the accepted
limitations) - not repeated here. This section only covers what's specific to porting it into this
clone, done the same day the feature landed in the template (see the "Shared logic can silently
drift out of sync" note above for why a manual port was needed at all).

- **This demo's own `rebuild-from-portal.js` and `index.html` were already byte-for-byte identical
  to the template's pre-multi-language versions** (confirmed via `cmp` before porting - a single
  stray comment word aside, see below), so the port was mechanical: the same functions/markers/
  `[data-i18n]` attributes, copied over rather than redesigned for this demo's shape.
- **Client 8 (this demo) has no `clients.languages` configured, same as client 5 before it landed
  there** - this is a complete no-op today, verified the same way: a scratch dry run against
  synthetic data with `languages: []` produces byte-identical dynamic marker content to the
  pre-change script, and the real `workflow_dispatch` run after this landed created no `es/`
  (or any locale) folder.
- **This demo has no "locations" per-day mode** (`location_mode = 'default'`, see "Identity" above)
  - `isPerDayLocationClient()` is always `false` here, so the per-day branches in
  `buildHoursTableRows()`/`buildHoursHeading()`/`buildLocationColumn()` are simply inert code paths
  that never fire for this client, not something removed or forked out. The `'default'`-mode branch
  of `buildLocationBlock()` (one saved location, rendered as a clickable heading + address + phone)
  is the one real data actually takes here - the food-truck demo's per-day branch is what stays
  untested by *this* repo, same as this repo's own `'default'` branch was untested by the food-truck
  demo before this demo existed (see "Why a second demo exists" above).
- **This demo has no `events` feature enabled** (see "Identity" above) - `buildEventsJsonLd()`/
  `buildEventCard()`/`buildEventsSection()` are equally inert here (the portal always returns `[]`
  for `events`), and this demo's nav was never given a `#events` link in the first place (the
  template's own note about that link being hand-added per-demo only applies to client 5). Kept as
  shared code with the food-truck demo rather than stripped out, same reasoning as the per-day
  location branches above.
- **One wording difference from the template's own comment, kept rather than copied verbatim**: the
  JSDoc above `buildMenuSection()` says "mirrors `buildEventsSection()` **above**" here (correct for
  this file's actual function order - `buildEventsSection()` is defined earlier in the file), not
  "below" as the template's own copy of that comment currently reads (a pre-existing, harmless stale
  cross-reference over there, not something introduced by this port, and not this repo's place to
  fix).
- **`i18n/en.json` copied verbatim from the template** - every chrome string it defines (nav labels,
  skip link, hero CTA, section headings, form labels/submit, footer rights, menu heading/intro/"All"
  pill/"Show Full Menu" label) was checked word-for-word against this demo's own hand-authored
  English text before copying, since a hard-coded "About"/"Get In Touch"/etc. anywhere in
  `index.html` only gets swapped by `applyChromeStrings()` if the JSON's English value matches
  character-for-character. No wording needed adjusting - this demo's chrome text already matched the
  template's defaults exactly. `i18n/es.json` was copied the same way (nothing here depends on this
  demo's own content, it's all generic UI chrome).

**Activated for real on this demo, 2026-09-04** (same day, requested directly): `i18n/ja.json` was
added (same 25-key set as `en.json`/`es.json`, also copied into `merkitech-essentials-starter` for
template parity, though not activated for that repo's own client), then portal migration 026 turned
on the `languages` feature and set `clients.languages = 'es,ja'` for client 8 - see "Identity" above.
A manually-triggered `workflow_dispatch` run confirmed `es/index.html` and `ja/index.html` generate
correctly (translated chrome, correct hreflang/canonical/`lang`, working language-switcher links),
and both are live at `restaurant-demo.merkitech.com/es/` and `/ja/`. Menu item/category translations
were filled in the same day too (via the portal's own admin login, not the bearer API) - all 3
categories and 13 items are genuinely translated into both languages, not just chrome text.

**Language switcher redesigned 2026-09-05** - since this is the only demo with 3 total languages
(en/es/ja), it's the one that actually exercises the dropdown shape of `buildLanguageSwitcher()` -
see `merkitech-essentials-starter/CLAUDE.md`'s own "Language switcher" note (under "Multi-language,
phase 2") for the full design; ported here the same mechanical way as the rest of phase 2, no
adaptation needed.

**A real bug in that redesign was caught live on this demo, same day**: `/es/` showed the new
markup with no styling and no click behavior - `es/index.html`/`ja/index.html` were bootstrapped
before this CSS/JS existed, and the original design only ever re-synced `PORTAL:*` markers on an
already-existing locale file, never the `<style>`/`<script>` blocks outside them. Fixed by
`syncTemplateInfrastructure()`, ported from the template the same mechanical way - see that repo's
CLAUDE.md for the full design (anchored on the tags/a content fingerprint, not a marker, so it
correctly patches a file that predates the fix with no separate migration step). This demo's own
`/es/`/`/ja/` were the real files that needed - and got - that patch, not just a template repo
someone might clone from later.

**`withEventClosures()` (an event optionally replacing the day's regular hours, portal migration
027) ported here 2026-09-04**, same mechanical way as the rest of phase 2 - see
`merkitech-essentials-starter/CLAUDE.md`'s own note under "Events" for the full design. This demo
has the `events` feature disabled (see "Identity" above), so the function is a complete no-op here
in practice, same as `buildEventsJsonLd()`/`buildEventsSection()` already were - kept as shared code
with the food-truck demo rather than forked out.

**Bespoke hero/About/meta copy in `es/index.html` and `ja/index.html` manually translated
2026-09-05** - caught live (`/es/` still showing the hero `<h1>`/tagline and both About paragraphs
in plain English), confirming this really is the accepted "bespoke prose, cloned once at bootstrap,
never auto-translated" gap `merkitech-essentials-starter/CLAUDE.md`'s "Known limitations" note
already documents, not a functionality bug - the mechanism already fully supports arbitrary
per-locale text, this content specifically just hadn't been written yet. Translated by hand directly
in each locale file (title/meta description/og:description, hero `<h1>`/tagline, both About
paragraphs, and the about-photo placeholder's caption text - a real, visible `<p>`, not a code
comment, easy to mistake for one). Business name/street address left untranslated on purpose (a
proper noun and a real US mailing address, same reasoning `merkitech-portal/CLAUDE.md` already gives
for why saved-location names/addresses go untranslated generally). Confirmed with a script-driven
sweep of both locale files afterward that nothing else matching this pattern remained.

**Order/reservation buttons, social links, and a printable menu, ported 2026-09-06** - same
mechanical port as the rest, see `merkitech-essentials-starter/CLAUDE.md`'s own section for the full
design (`buildOrderButtons()`/`buildSocialLinks()`/the `@media print` stylesheet). Two real test
links (an Instagram profile, an OpenTable reservation link) were added to this client (id 8) via the
portal to verify live, not left as a purely-code-level check - confirmed rendering correctly on
`/`, `/es/`, and `/ja/`. **This demo is also what `ensureMarkerAt()` (the marker self-heal fix for
an already-bootstrapped locale file predating a brand-new `PORTAL:*` marker) was verified against
before shipping** - its real `es/index.html`/`ja/index.html` are exactly the "bootstrapped before
this marker existed" case that function exists for, same role this demo already played for the
CSS/JS sync fix earlier.
