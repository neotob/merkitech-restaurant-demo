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

- **Portal client id 8**, tier `portal`, `enabled_features = locations` (no `events` - this demo is
  deliberately the *other* direction from client 5, which already covers events/per-day locations).
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
