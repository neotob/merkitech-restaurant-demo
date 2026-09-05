// Fetches this client's hours/menu from the Merki Tech portal and regenerates
// the corresponding sections of index.html in place - the JSON-LD
// openingHoursSpecification, the visible hours table, and the menu filter
// pills + grid. Also generates one additional index.html per extra language
// configured on the portal (clients.languages), under its own /{locale}/
// subfolder - see the "Multi-language" section in CLAUDE.md for the full
// design (why chrome text uses [data-i18n] + i18n/*.json but menu/category
// translations come from the portal API, why the primary/root file is never
// touched by any of that, and what's still NOT translated by this - bespoke
// hero/about copy, event names/descriptions, JSON-LD).
//
// Run via `node .github/scripts/rebuild-from-portal.js` from the repo root,
// with PORTAL_URL, PORTAL_API_TOKEN, and PORTAL_CLIENT_ID set in the
// environment (the deploy workflow supplies these from repo secrets).

const fs = require('fs');

const PORTAL_URL = requireEnv('PORTAL_URL');
const PORTAL_API_TOKEN = requireEnv('PORTAL_API_TOKEN');
const PORTAL_CLIENT_ID = requireEnv('PORTAL_CLIENT_ID');

// The portal's host runs a bot-check (Imunify360 or similar) that serves a
// JS-verification interstitial instead of reaching PHP for requests with a
// non-browser User-Agent - a real HTTP 200, so a naive fetch would silently
// get an HTML page back instead of JSON. See merkitech-portal/CLAUDE.md.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
// English day names for JSON-LD only (schema.org's dayOfWeek is structured
// metadata, not display text - it stays the canonical English form
// regardless of which language a given generated page is in). For the
// *visible* hours table, see dayLabel() below instead, which is locale-aware.
const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
// Arbitrary real Mon-Sun week (2024-01-01 was a Monday), used only to ask
// Intl for "what is this weekday called in this locale" - never displayed
// as a date itself.
const DAY_REFERENCE_ISO = { mon: '2024-01-01', tue: '2024-01-02', wed: '2024-01-03', thu: '2024-01-04', fri: '2024-01-05', sat: '2024-01-06', sun: '2024-01-07' };

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`missing required environment variable: ${name}`);
    }
    return value;
}

// Retries on a bad-JSON response (the bot-check interstitial, see the
// BROWSER_UA comment above, still returns real HTTP 200s) rather than just
// the User-Agent header alone - hit for real on 2026-09-02 once a 4th
// concurrent request (this script used to fire 3 at once, now 4 with events
// added) started intermittently tripping it, where 3 never had. Fetches were
// also switched from Promise.all to sequential (see main()) as the primary
// fix; this retry is defense-in-depth for whatever residual burst traffic
// still reaches the host at once. Raised from 3 to 5 attempts / longer
// backoff on 2026-09-02 after a deliberate 30-runs-in-one-minute stress test
// (proving the workflow's concurrency fix) burned through 3 attempts anyway
// - real client edits don't fire that fast, but there's no cost to the extra
// headroom.
async function fetchPortal(resource, attempt = 1) {
    const url = `${PORTAL_URL}/api/admin.php?resource=${resource}&client_id=${PORTAL_CLIENT_ID}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, 'X-Api-Token': PORTAL_API_TOKEN },
    });
    if (!res.ok) {
        throw new Error(`portal API ${resource} returned HTTP ${res.status}`);
    }

    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (err) {
        if (attempt >= 5) {
            throw new Error(`portal API ${resource} did not return JSON after ${attempt} attempts (got: ${text.slice(0, 120)})`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        return fetchPortal(resource, attempt + 1);
    }
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'category';
}

function formatPrice(price) {
    const n = Number(price);
    return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function isClosed(dayRow) {
    return dayRow.is_closed === 1 || dayRow.is_closed === '1' || dayRow.is_closed === true;
}

// A weekday's display name in a given Intl locale tag ("en-US", "es", ...) -
// capitalized regardless of the locale's own grammatical convention (some,
// like Spanish, lowercase weekday names in running text), matching how this
// table has always shown them. Used for the *visible* hours table only - see
// DAY_LABELS above for JSON-LD's separate, always-English need.
function dayLabel(day, intlLocale) {
    const label = new Date(`${DAY_REFERENCE_ISO[day]}T00:00:00Z`).toLocaleDateString(intlLocale, { weekday: 'long', timeZone: 'UTC' });
    return label.charAt(0).toUpperCase() + label.slice(1);
}

// yyyy-mm-dd -> "Nov 28" (locale-formatted month) - parsed as UTC and
// formatted in UTC so a date string from the portal's DATE column never
// shifts a day under the runner's local timezone (a plain `new
// Date('2026-11-28')` is UTC midnight; formatting it with the *local* zone
// can print the day before west of UTC).
function formatSpecialDate(isoDate, intlLocale) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(intlLocale, {
        month: 'short', day: 'numeric', timeZone: 'UTC',
    });
}

// A single day prints as before ("Sep 7"); a real range (portal migration
// 017, 2026-09-04) prints both ends ("Sep 10 – Sep 24") - always with both
// months spelled out rather than trying to compress a same-month range, to
// keep this simple and avoid a second, subtly-different date format on the
// same page.
function formatSpecialDateRange(startIso, endIso, intlLocale) {
    if (startIso === endIso) return formatSpecialDate(startIso, intlLocale);
    return `${formatSpecialDate(startIso, intlLocale)} – ${formatSpecialDate(endIso, intlLocale)}`;
}

function isAvailable(item) {
    return !(item.is_available === 0 || item.is_available === '0' || item.is_available === false);
}

function formatClockTime(hhmmss) {
    const [h, m] = hhmmss.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Shared by every "link to a place on a map" spot below (per-day locations,
// the default location, event locations) - a Maps search URL works as a
// fallback wherever there's no exact pinned link yet.
function mapsSearchUrl(query) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// --- Multi-language support (added 2026-09-04) -----------------------------
//
// Two independent translation sources, deliberately not unified:
//  - Static template "chrome" (nav labels, section headings, button/form
//    text) comes from i18n/{locale}.json, looked up by the [data-i18n="key"]
//    attribute already sitting on the relevant elements in index.html - see
//    applyChromeStrings(). English values live in i18n/en.json and *are*
//    what's already hardcoded in index.html; a translated locale's file
//    falls back to them for any key its own JSON is missing.
//  - Portal-managed content (menu item/category names+descriptions) comes
//    from the portal API's own `translations` field on each entity - see
//    localizedField().
// Neither covers: hero/about bespoke prose, meta title/description/OG tags,
// or event names/descriptions/JSON-LD - these stay whatever language they
// were entered in on every generated version. See CLAUDE.md.

function loadStrings(locale) {
    const en = JSON.parse(fs.readFileSync('i18n/en.json', 'utf8'));
    if (!locale || locale === 'en') return en;

    let localized = {};
    try {
        localized = JSON.parse(fs.readFileSync(`i18n/${locale}.json`, 'utf8'));
    } catch (err) {
        // No translation file for this locale yet - fall back to English
        // entirely rather than failing the whole build; a client shouldn't
        // lose their site over one missing i18n/*.json file.
        console.warn(`no i18n/${locale}.json found - "${locale}" version will use English chrome text until one's added.`);
    }
    return { ...en, ...localized };
}

// `locale` is the additional-language code this call is for, or null/'en'
// for the primary/root file - null means "never touch, use the entity's own
// primary-language field", matching root's zero-risk guarantee everywhere
// this is called.
function localizedField(entity, locale, field) {
    if (!locale || locale === 'en') return entity[field];
    const translated = entity.translations && entity.translations[locale] && entity.translations[locale][field];
    return translated || entity[field];
}

// Swaps the text of every [data-i18n="key"] element for strings[key] - only
// ever called for a non-primary locale file (see main()), root's own chrome
// text is never touched by this. Every tagged element in index.html has
// data-i18n as its last attribute with plain text (no nested tags)
// immediately following, by construction - see CLAUDE.md - which is what
// lets one regex handle all of them without a DOM library.
function applyChromeStrings(html, strings) {
    return html.replace(/data-i18n="([^"]+)">([^<]*)</g, (match, key) => {
        return strings[key] !== undefined ? `data-i18n="${key}">${escapeHtml(strings[key])}<` : match;
    });
}

function setHtmlLang(html, locale) {
    return html.replace(/<html lang="[^"]*">/, `<html lang="${locale || 'en'}">`);
}

function rootCanonicalUrl(rootHtml) {
    const match = rootHtml.match(/<link rel="canonical" href="([^"]+)">/);
    return match ? match[1].replace(/\/+$/, '') : null;
}

// Only ever called for a non-root locale file - root's own canonical tag is
// hand-edited per client (see README) and never touched here. A translated
// page needs its *own* self-referencing canonical (not a leftover copy of
// root's), otherwise it reads as a duplicate of root rather than a real
// alternate-language version - hreflang tags alone don't fix that.
function setCanonical(html, url) {
    return html.replace(/<link rel="canonical" href="[^"]+">/, `<link rel="canonical" href="${escapeHtml(url)}">`);
}

// One <link rel="alternate" hreflang="..."> per generated version, root
// included (self-referencing) - the standard way to tell search engines
// these are translations of each other, not duplicate content. Empty when
// there's no site_url to build absolute URLs from, or no additional
// languages configured at all (the common case today).
//
// Assumes the primary/root content's language is "en" - there's no
// clients.primary_language column (nothing tracks this explicitly), but
// every real client's base content is realistically English; revisit if
// that's ever not true for a real client rather than building it
// speculatively now.
function buildHreflangTags(client, additionalLanguages) {
    if (!client.site_url || !additionalLanguages.length) return '';

    const base = client.site_url.replace(/\/+$/, '');
    const allLocales = ['en', ...additionalLanguages];
    return allLocales
        .map(loc => `    <link rel="alternate" hreflang="${loc}" href="${base}/${loc === 'en' ? '' : loc + '/'}">`)
        .join('\n');
}

// Deliberately styled distinct from the plain nav links around it (its own
// "pill" class, not the nav's own `a` styling - see .lang-switch-pill in
// index.html) so it doesn't read as "just another section link" - requested
// directly once the plain-text version was live. Two total languages (the
// overwhelmingly common case - one client, one extra language): a single
// direct pill-styled link to the other one, no dropdown needed for one
// item. Three or more: the pill shows the *current* language and toggles a
// small dropdown of every other one on click (see the toggle script in
// index.html) - a flat list of 3+ links read as more clutter than a single
// current-language control that expands on demand. Visible labels are just
// the uppercased locale code (ES, EN, JA, ...) - avoids needing a "language
// name in its own language" dictionary for something this small.
function buildLanguageSwitcher(currentLocale, additionalLanguages) {
    const allLocales = ['en', ...additionalLanguages];
    if (allLocales.length < 2) return '';

    const current = currentLocale || 'en';
    const others = allLocales.filter(loc => loc !== current);

    if (allLocales.length === 2) {
        const other = others[0];
        const href = other === 'en' ? '/' : `/${other}/`;
        return `                <li><a href="${href}" class="lang-switch-pill">${other.toUpperCase()}</a></li>`;
    }

    const items = others
        .map(loc => `                        <li><a href="${loc === 'en' ? '/' : '/' + loc + '/'}">${loc.toUpperCase()}</a></li>`)
        .join('\n');
    return `                <li class="lang-switcher">
                    <button type="button" class="lang-switch-pill" aria-expanded="false" aria-haspopup="true">${current.toUpperCase()}</button>
                    <ul class="lang-switch-dropdown" hidden>
${items}
                    </ul>
                </li>`;
}

// A food truck's day-by-day spot - its own 3rd table column (Day | Time |
// Location, see buildHoursTableRows()) as of 2026-09-04, previously a 4th
// element tacked onto the Time cell. Since migration 013 (2026-09-04) `row`
// is a saved Locations-table entry (name/address/maps_url), not a freeform
// string - prefers an exact pinned maps_url when the owner set one,
// otherwise falls back to a Maps search of the address, then the name.
function buildLocationLink(row) {
    if (!row.location_name) return '';
    const href = row.location_maps_url || mapsSearchUrl(row.location_address || row.location_name);
    return `<a class="hours-location" href="${escapeHtml(href)}" target="_blank" rel="noopener">📍 ${escapeHtml(row.location_name)}</a>`;
}

// Per-day location links only render in 'per_day' mode (ClientRepository::
// LOCATION_MODES) - in 'default' mode the one location lives in the
// right-hand Location column instead (see buildLocationBlock()), so
// repeating it on every row would be redundant even though the data might
// still be sitting on some of these rows from before a client switched
// modes. A 'per_day' client always gets a 3rd <td> per row (empty string
// when that particular day has no location) rather than omitting the cell
// on days without one - every row needs the same cell count for the
// columns to actually line up (see index.html's `:has(td:nth-child(3))`
// CSS, which detects "3-column mode" this way and would misalign a mix of
// 2- and 3-cell rows).
function buildHoursTableRows(hours, client, intlLocale, strings) {
    const showPerDayLocation = isPerDayLocationClient(client);
    return DAY_ORDER.map(day => {
        const row = hours[day];
        const value = isClosed(row) ? strings['hours.closed'] : `${formatClockTime(row.open_time)} – ${formatClockTime(row.close_time)}`;
        const locationCell = showPerDayLocation ? `<td>${buildLocationLink(row)}</td>` : '';
        return `                            <tr data-day="${day}"><td>${escapeHtml(dayLabel(day, intlLocale))}</td><td>${escapeHtml(value)}</td>${locationCell}</tr>`;
    }).join('\n');
}

// Only the heading directly above the hours table (see PORTAL:HOURS-HEADING
// in index.html) - suppressed for a 'per_day' client since the section's
// own "Hours & Location" <h2> right above already says it, and with the
// second grid column also gone (see buildLocationColumn()) repeating
// "Hours" here read as a redundant middle heading rather than a real
// subtitle. This demo has no locations feature (single fixed address) so
// isPerDayLocationClient() is always false here - the heading always shows -
// but the check stays shared code with the food-truck demo, not forked.
function buildHoursHeading(client, strings) {
    return isPerDayLocationClient(client) ? '' : `<h3>${escapeHtml(strings['hours.subheading'])}</h3>`;
}

function buildOpeningHoursSpecification(hours) {
    return DAY_ORDER
        .filter(day => !isClosed(hours[day]))
        .map(day => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: DAY_LABELS[day],
            opens: hours[day].open_time.slice(0, 5),
            closes: hours[day].close_time.slice(0, 5),
        }));
}

// specialOpeningHoursSpecification overrides the regular weekly hours above
// for specific dates (holiday closures, one-off event hours) - validFrom/
// validThrough span the whole range (portal migration 017, 2026-09-04;
// end_date equals date for an ordinary single day, so this covers both
// without a branch). Bots don't benefit from a "don't show it if it's too
// far out" cutoff the way a human reading the page does, so every
// future-dated entry the portal returns goes in, with no date-range
// filtering here (the portal's own upcomingForClient() already excludes
// entries that have fully ended). A closed day is expressed as opens/closes
// both "00:00" rather than omitting them - the more broadly-recognized
// convention for "closed on this date" in this schema.
function buildSpecialOpeningHoursSpecification(specialHours) {
    return specialHours.map(entry => ({
        '@type': 'OpeningHoursSpecification',
        validFrom: entry.date,
        validThrough: entry.end_date || entry.date,
        opens: isClosed(entry) ? '00:00' : entry.open_time.slice(0, 5),
        closes: isClosed(entry) ? '00:00' : entry.close_time.slice(0, 5),
    }));
}

function buildSpecialHoursSection(specialHours, intlLocale, strings) {
    if (!specialHours.length) return '';

    const rows = specialHours.map(entry => {
        const endDate = entry.end_date || entry.date;
        const value = isClosed(entry)
            ? strings['hours.closed']
            : `${formatClockTime(entry.open_time)} – ${formatClockTime(entry.close_time)}`;
        const note = entry.note ? ` <span class="special-hours-note">(${escapeHtml(entry.note)})</span>` : '';
        // data-start/data-end (not a single fixed data-day anymore) - a range
        // can span multiple weekdays, so which regular-hours rows it affects
        // has to be worked out client-side per calendar day, not baked in
        // here as one weekday. See the "highlight this week's special hours"
        // script in index.html.
        return `                                <tr data-start="${entry.date}" data-end="${endDate}"><td>${formatSpecialDateRange(entry.date, endDate, intlLocale)}</td><td>${escapeHtml(value)}${note}</td></tr>`;
    }).join('\n');

    return `                        <div class="special-hours">
                            <h4>${escapeHtml(strings['hours.special_heading'])}</h4>
                            <table class="hours-table">
${rows}
                            </table>
                        </div>`;
}

// Hawaii Standard Time has no DST, so this offset is always correct for this
// product's Hawaii-only client base - revisit if a client outside HST ever
// happens, since this is hardcoded rather than derived per-client.
const HAWAII_UTC_OFFSET = '-10:00';

function toIsoDateTime(isoDate, hhmm) {
    return `${isoDate}T${hhmm.length === 5 ? hhmm + ':00' : hhmm}${HAWAII_UTC_OFFSET}`;
}

function formatEventDay(isoDate) {
    return String(Number(isoDate.split('-')[2]));
}

function formatEventMonth(isoDate, intlLocale) {
    const [y, m] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(intlLocale, { month: 'short', timeZone: 'UTC' });
}

// Google requires name/startDate/location for Event rich-result eligibility,
// but an event with no location entered still gets a (non-rich-result-
// eligible) Event object here rather than being dropped outright - still
// valid schema.org, and the location can always be filled in later. Not
// localized - an event's own name/description/location are portal content
// with no translation table behind them (unlike menu items/categories),
// same as the visible event card below - see CLAUDE.md. This demo has no
// "events" feature enabled (see CLAUDE.md), so events is always `[]` and
// this whole function is inert here, same as the food-truck demo's own
// isPerDayLocationClient() branch is inert there - kept as shared code
// rather than forked out.
function buildEventsJsonLd(events) {
    return events.map(event => {
        const json = {
            '@type': 'Event',
            name: event.name,
            startDate: toIsoDateTime(event.event_date, event.start_time),
            eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
            eventStatus: 'https://schema.org/EventScheduled',
        };
        if (event.end_time) {
            json.endDate = toIsoDateTime(event.event_date, event.end_time);
        }
        if (event.description) {
            json.description = event.description;
        }
        if (event.location_name) {
            json.location = { '@type': 'Place', name: event.location_name };
            if (event.location_address) {
                json.location.address = event.location_address;
            }
        }
        if (event.link_url) {
            json.url = event.link_url;
        }
        return json;
    });
}

// Only the fields a client actually filled in appear on the card - an event
// with no location, say, just doesn't get a location line rather than
// showing one with blank/placeholder text. event.name/description/location
// stay whatever language they were entered in on every generated version -
// see the class comment on buildEventsJsonLd() above.
function buildEventCard(event, intlLocale, strings) {
    const timeRange = event.end_time
        ? `${formatClockTime(event.start_time)} – ${formatClockTime(event.end_time)}`
        : formatClockTime(event.start_time);
    const locationParts = [event.location_name, event.location_address].filter(Boolean);
    // Prefer the address for the Maps query (more precise than a venue name
    // alone) but fall back to the name when only that was filled in.
    const mapsQuery = event.location_address || event.location_name;
    const locationText = escapeHtml(locationParts.join(' — '));
    const locationLine = locationParts.length
        ? `<p class="event-location">📍 <a href="${mapsSearchUrl(mapsQuery)}" target="_blank" rel="noopener">${locationText}</a></p>`
        : null;

    const detailLines = [
        `<p class="event-time">${timeRange}</p>`,
        event.description ? `<p>${escapeHtml(event.description)}</p>` : null,
        locationLine,
        event.link_url ? `<a class="event-link" href="${escapeHtml(event.link_url)}" target="_blank" rel="noopener">${escapeHtml(strings['events.more_info'])}</a>` : null,
    ].filter(Boolean).join('\n                            ');

    return `                    <div class="event-card">
                        <div class="event-date-badge">
                            <span class="day">${formatEventDay(event.event_date)}</span>
                            <span class="month">${escapeHtml(formatEventMonth(event.event_date, intlLocale))}</span>
                        </div>
                        <div class="event-details">
                            <h3>${escapeHtml(event.name)}</h3>
                            ${detailLines}
                        </div>
                    </div>`;
}

function buildEventsSection(events, intlLocale, strings) {
    if (!events.length) return '';
    return `                <section class="section" id="events">
                    <div class="container">
                        <h2>${escapeHtml(strings['events.heading'])}</h2>
                        <div class="events-list">
${events.map(e => buildEventCard(e, intlLocale, strings)).join('\n')}
                        </div>
                    </div>
                </section>`;
}

function buildMenuFilters(categories, locale) {
    return categories
        .map(cat => `                    <button class="menu-filter" data-filter="${slugify(cat.name)}" aria-pressed="false">${escapeHtml(localizedField(cat, locale, 'name'))}</button>`)
        .join('\n');
}

/**
 * The whole "Our Menu" section (heading included), emitted only when there's
 * anything to show - mirrors buildEventsSection() above, added 2026-09-04 to
 * close the same gap Events already didn't have: with only the filters/grid
 * markers previously wrapped (not the section itself), turning a client's
 * menu off emptied the grid but left the "Our Menu" heading and empty filter
 * bar showing over nothing. `menu` is already `[]` from the portal API
 * whenever menu_enabled is off (see merkitech-portal's public/api/admin.php),
 * so the same "no data -> no section" check Events uses works here for free
 * - no separate client.menu_enabled check needed.
 */
function buildMenuSection(categories, locale, strings) {
    if (!categories.length) return '';
    return `                <section class="section" id="menu">
                    <h2>${escapeHtml(strings['menu.heading'])}</h2>
                    <p class="section-intro">${escapeHtml(strings['menu.intro'])}</p>
                    <div class="menu-filters" id="menuFilters">
                        <button class="menu-filter active" data-filter="all" aria-pressed="true">${escapeHtml(strings['menu.filter_all'])}</button>
${buildMenuFilters(categories, locale)}
                    </div>
                    <div class="menu-grid" id="menuGrid">
${buildMenuGrid(categories, locale)}
                        <!-- Static regardless of portal data - the menu-preview JS overwrites its
                             label with the real item count on load (in English always - see
                             CLAUDE.md's multi-language section for this known limitation). -->
                        <button type="button" id="menuShowMore" class="menu-show-more hidden">${escapeHtml(strings['menu.show_full'])}</button>
                    </div>
                </section>`;
}

function buildMenuGrid(categories, locale) {
    // An item can belong to more than one portal category (e.g. "Bestsellers"
    // and "Mains"), so it's nested under each of those categories' .items in
    // the API response - de-duplicate by id into one card per item (not one
    // per category membership - see CLAUDE.md for why re-introducing that
    // duplication was deliberately ruled out), with every category it
    // belongs to folded into one space-separated data-category (the filter
    // JS checks membership in that list, not equality against the whole
    // attribute).
    const cardsById = new Map();
    for (const cat of categories) {
        for (const item of cat.items) {
            if (!isAvailable(item)) continue; // sold-out items don't show on the public site
            if (!cardsById.has(item.id)) {
                cardsById.set(item.id, { item, slugs: new Set() });
            }
            cardsById.get(item.id).slugs.add(slugify(cat.name));
        }
    }

    // Portal migration 022 (2026-09-04) - empty/absent means every day, same
    // as before this existed, so no attribute at all is the common case.
    // "Is today one of these days" can't be resolved here (this script only
    // runs when someone saves a change, not daily) - see the client-side
    // script in index.html that actually hides a card on a day it doesn't
    // apply, and CLAUDE.md for the full reasoning.
    function buildCard(item, slugs) {
        const daysAttr = item.available_days && item.available_days.length
            ? ` data-available-days="${item.available_days.join(',')}"`
            : '';
        // Portal migration (2026-09-04, menu_items.photo_url - see
        // PhotoUploader.php/R2Client.php) - omitted entirely when no photo
        // has been uploaded yet, so a client who never adds photos gets the
        // exact same plain text card as before this existed.
        const name = localizedField(item, locale, 'name');
        const description = localizedField(item, locale, 'description');
        const photoHtml = item.photo_url
            ? `<img class="menu-item-photo" src="${escapeHtml(item.photo_url)}" alt="${escapeHtml(name)}" loading="lazy">`
            : '';
        return `                    <div class="menu-item" data-category="${[...slugs].join(' ')}"${daysAttr}>
                        ${photoHtml}<span class="price">${formatPrice(item.price)}</span>
                        <h4>${escapeHtml(name)}</h4>
                        <p>${escapeHtml(description || '')}</p>
                    </div>`;
    }

    // A category heading before each group, added 2026-09-02 once a client
    // with 30+ items across 7 categories made the unfiltered "All" view read
    // as one undifferentiated wall of cards - see CLAUDE.md. A multi-category
    // item still gets exactly one card (no duplication), grouped under
    // whichever of its categories comes first in the portal's own order -
    // its data-category attribute still lists every category it belongs to,
    // so filtering to any of them still finds it regardless of which
    // heading it's visually grouped under.
    const placed = new Set();
    const blocks = [];
    for (const cat of categories) {
        const itemsHere = cat.items.filter(item => isAvailable(item) && !placed.has(item.id));
        if (!itemsHere.length) continue;

        blocks.push(`                    <h3 class="menu-category-heading" data-category-heading="${slugify(cat.name)}">${escapeHtml(localizedField(cat, locale, 'name'))}</h3>`);
        for (const item of itemsHere) {
            placed.add(item.id);
            blocks.push(buildCard(item, cardsById.get(item.id).slugs));
        }
    }
    return blocks.join('\n');
}

function replaceBetweenMarkers(html, marker, newContent) {
    const start = `<!-- PORTAL:${marker}:START -->`;
    const end = `<!-- PORTAL:${marker}:END -->`;
    const startIdx = html.indexOf(start);
    const endIdx = html.indexOf(end);
    if (startIdx === -1 || endIdx === -1) {
        throw new Error(`PORTAL:${marker} markers not found in index.html`);
    }
    return html.slice(0, startIdx + start.length) + '\n' + newContent + '\n' + html.slice(endIdx);
}

// Only ever replaces the placeholder illustration with a real photo once
// the client has uploaded one (clients.photo_url, general.php) - returns
// null (meaning "leave whatever's there alone") otherwise, so a client who
// never uploads a photo keeps the original placeholder. See the
// PORTAL:ABOUT-PHOTO comment in index.html for the one accepted limitation
// this creates: removing an already-set photo later doesn't bring the
// placeholder back, since this only ever moves one direction.
function buildAboutPhoto(client) {
    if (!client.photo_url) return null;
    return `<div class="about-photo"><img src="${escapeHtml(client.photo_url)}" alt="${escapeHtml(client.business_name)}"></div>`;
}

function updateJsonLd(html, hours, specialHours, client) {
    const start = '<!-- PORTAL:JSONLD:START -->';
    const end = '<!-- PORTAL:JSONLD:END -->';
    const startIdx = html.indexOf(start);
    const endIdx = html.indexOf(end);
    if (startIdx === -1 || endIdx === -1) {
        throw new Error('PORTAL:JSONLD markers not found in index.html');
    }

    const block = html.slice(startIdx + start.length, endIdx);
    const scriptMatch = block.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!scriptMatch) {
        throw new Error('could not find the JSON-LD <script> tag inside the PORTAL:JSONLD markers');
    }

    const data = JSON.parse(scriptMatch[1]);
    data.openingHoursSpecification = buildOpeningHoursSpecification(hours);
    // telephone is a plain string, so syncing it from the portal is safe and
    // exact - unlike `address`, which stays hand-edited on purpose (see
    // buildLocationBlock() and CLAUDE.md): schema.org's structured
    // PostalAddress needs street/city/state/zip broken out, and the portal
    // only stores one freeform address string. Decomposing that reliably
    // isn't worth the risk of silently corrupting real structured data, so
    // this only touches the one field that's actually safe to overwrite.
    if (client.phone) {
        data.telephone = client.phone;
    }
    if (specialHours.length) {
        data.specialOpeningHoursSpecification = buildSpecialOpeningHoursSpecification(specialHours);
    } else {
        delete data.specialOpeningHoursSpecification;
    }

    const indentedJson = JSON.stringify(data, null, 2).split('\n').join('\n    ');
    const newScript = `<script type="application/ld+json">\n    ${indentedJson}\n    </script>`;
    // A function replacer, not a string one: String.replace() treats "$" specially
    // in a string replacement (e.g. "$$" collapses to a literal "$"), which silently
    // corrupted priceRange ("$$" -> "$") the first time this ran against real data.
    const newBlock = block.replace(scriptMatch[0], () => newScript);

    return html.slice(0, startIdx + start.length) + newBlock + html.slice(endIdx);
}

// Events get their own top-level JSON-LD script (see the PORTAL:EVENTS-JSONLD
// comment in index.html for why it's separate from the Restaurant block) -
// the whole <script> tag is emitted/removed here, not edited in place like
// updateJsonLd() does, since there's nothing to preserve when there are none.
function updateEventsJsonLd(html, events) {
    const start = '<!-- PORTAL:EVENTS-JSONLD:START -->';
    const end = '<!-- PORTAL:EVENTS-JSONLD:END -->';
    const startIdx = html.indexOf(start);
    const endIdx = html.indexOf(end);
    if (startIdx === -1 || endIdx === -1) {
        throw new Error('PORTAL:EVENTS-JSONLD markers not found in index.html');
    }

    let block = '';
    if (events.length) {
        const indented = JSON.stringify(buildEventsJsonLd(events), null, 2).split('\n').join('\n    ');
        block = `<script type="application/ld+json">\n    ${indented}\n    </script>`;
    }

    return html.slice(0, startIdx + start.length) + '\n' + block + '\n' + html.slice(endIdx);
}

// Mirrors ClientRepository::hasFeature() - enabled_features is the same
// plain comma-separated string on both sides, not a JSON column.
function clientHasFeature(client, feature) {
    return String(client.enabled_features || '').split(',').includes(feature);
}

// Shared by buildHoursTableRows(), buildHoursHeading(), and
// buildLocationColumn() - all three branch on exactly this same condition,
// factored out 2026-09-04 once a 3rd call site made repeating the inline
// check three times worth avoiding.
function isPerDayLocationClient(client) {
    return clientHasFeature(client, 'locations') && client.location_mode === 'per_day';
}

// Content of the second grid column of "Hours & Location" - address/phone
// are portal-managed (added 2026-09-03), not hand-edited HTML. Only reached
// for a client NOT in 'per_day' locations mode (see buildLocationColumn()
// just below, which omits this whole column for that case instead) - so
// this only ever needs to handle 'default' mode (one location, picked from
// the saved Locations list on general.php) and the no-"locations"-feature
// plain address/phone fallback. Only the fields actually filled in appear,
// same "no empty placeholder line" rule as everywhere else in this script.
// A saved location's own name/address (client data) stays untranslated,
// same as everywhere else client-entered text isn't backed by the
// translations table - only the "Location" fallback heading is chrome. This
// demo is exactly the 'default'-mode branch (one saved location, see
// CLAUDE.md), so that's the path real data actually takes here.
function buildLocationBlock(client, strings) {
    const phoneLine = client.phone
        ? `<p style="margin-top: 1rem;"><span aria-hidden="true">📞</span> ${escapeHtml(client.phone)}</p>`
        : '';

    if (clientHasFeature(client, 'locations') && client.location_mode === 'default') {
        const loc = client.default_location;
        if (loc) {
            const href = loc.maps_url || mapsSearchUrl(loc.address || loc.name);
            const addressLine = loc.address ? `<p>${escapeHtml(loc.address)}</p>` : '';
            return `<h3><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(loc.name)}</a></h3>
                        ${addressLine}
                        ${phoneLine}`;
        }
        // Nothing picked yet on general.php - fall through to the plain
        // address/phone block below rather than showing nothing.
    }

    const addressLine = client.address ? `<p>${escapeHtml(client.address)}</p>` : '';
    return `<h3>${escapeHtml(strings['location.heading'])}</h3>
                        ${addressLine}
                        ${phoneLine}`;
}

// The whole second grid column, wrapping <div> included - see
// PORTAL:LOCATION-COLUMN in index.html. Omitted entirely (empty string) for
// a 'per_day' client, added 2026-09-04: that client's own per-day location
// links (buildLocationLink(), shown right next to each day's hours in the
// column to the left) already say where they are each day, so a second,
// generic "Find Us" panel here read as redundant once sitting right next to
// a real per-day schedule. The hours column on its own then simply fills
// the row - a CSS grid with only one child does this automatically (see
// .info-grid in index.html), no layout class needed here. This demo is
// always in 'default' mode (see CLAUDE.md), so isPerDayLocationClient() is
// always false here and this column always renders - the per-day branch is
// inert, kept as shared code with the food-truck demo rather than forked.
function buildLocationColumn(client, strings) {
    if (isPerDayLocationClient(client)) {
        return '';
    }

    return `                    <div>
                        ${buildLocationBlock(client, strings)}
                    </div>`;
}

// Regenerates one file (root index.html, or one additional locale's own
// {locale}/index.html) in place. `locale` is null for the primary/root file
// - every function above that takes it treats null as "don't translate,
// this is the primary content", so calling this with locale=null for root
// reproduces exactly what this script always did before multi-language
// existed, byte-for-byte.
function buildLocaleFile(path, locale, data) {
    const { client, hours, specialHours, events, menu, additionalLanguages } = data;
    const intlLocale = locale || 'en-US'; // matches this script's pre-existing hardcoded default
    const strings = loadStrings(locale);

    let html = fs.readFileSync(path, 'utf8');
    html = updateJsonLd(html, hours, specialHours, client);
    html = updateEventsJsonLd(html, events);
    const aboutPhoto = buildAboutPhoto(client);
    if (aboutPhoto !== null) {
        html = replaceBetweenMarkers(html, 'ABOUT-PHOTO', aboutPhoto);
    }
    html = replaceBetweenMarkers(html, 'HOURS-HEADING', buildHoursHeading(client, strings));
    html = replaceBetweenMarkers(html, 'HOURS-TABLE', buildHoursTableRows(hours, client, intlLocale, strings));
    html = replaceBetweenMarkers(html, 'SPECIAL-HOURS', buildSpecialHoursSection(specialHours, intlLocale, strings));
    html = replaceBetweenMarkers(html, 'LOCATION-COLUMN', buildLocationColumn(client, strings));
    html = replaceBetweenMarkers(html, 'EVENTS-SECTION', buildEventsSection(events, intlLocale, strings));
    html = replaceBetweenMarkers(html, 'MENU-SECTION', buildMenuSection(menu, locale, strings));
    html = replaceBetweenMarkers(html, 'HREFLANG', buildHreflangTags(client, additionalLanguages));
    html = replaceBetweenMarkers(html, 'LANG-SWITCHER', buildLanguageSwitcher(locale, additionalLanguages));
    html = setHtmlLang(html, locale);

    // Chrome text and the self-referencing canonical URL are the only two
    // things that differ for a translated file vs. root beyond the markers
    // above - both skipped entirely for root (locale === null), which is
    // what keeps root byte-for-byte identical to this script's pre-
    // multi-language behavior.
    if (locale) {
        const rootUrl = rootCanonicalUrl(fs.readFileSync('index.html', 'utf8'));
        if (rootUrl) {
            html = setCanonical(html, `${rootUrl}/${locale}/`);
        }
        html = applyChromeStrings(html, strings);
    }

    fs.writeFileSync(path, html);
}

async function main() {
    // Sequential, not Promise.all - 4 concurrent requests from the runner's
    // IP started intermittently tripping the host's bot-check where 3 never
    // did (see fetchPortal's retry too, as a second layer of defense against
    // the same interstitial). This job isn't latency-sensitive enough for
    // the extra few hundred ms of sequential round-trips to matter.
    const client = await fetchPortal('client');
    const hours = await fetchPortal('hours');
    const specialHours = await fetchPortal('special_hours');
    const events = await fetchPortal('events');
    const menu = await fetchPortal('menu');

    const additionalLanguages = Array.isArray(client.languages) ? client.languages : [];
    const data = { client, hours, specialHours, events, menu, additionalLanguages };

    // Root always regenerates first - a new additional language's file is
    // bootstrapped by cloning root's *current* content (see below), so root
    // must already be up to date before that copy happens.
    buildLocaleFile('index.html', null, data);

    for (const locale of additionalLanguages) {
        if (!fs.existsSync(locale)) {
            fs.mkdirSync(locale);
        }
        const localePath = `${locale}/index.html`;
        if (!fs.existsSync(localePath)) {
            // First time this language is configured for this client - clone
            // root's current file as a starting point. This preserves
            // whatever hand-authored hero/about/meta copy exists (in
            // English, untranslated) rather than leaving it blank; a human
            // can hand-translate that specific prose afterward directly in
            // this file, and it'll survive every future rebuild exactly like
            // root's own hand-authored content does - later runs only ever
            // touch this file's PORTAL markers and [data-i18n] chrome text,
            // never re-clone over it. See CLAUDE.md.
            fs.writeFileSync(localePath, fs.readFileSync('index.html', 'utf8'));
        }
        buildLocaleFile(localePath, locale, data);
    }

    const suffix = additionalLanguages.length
        ? ` (+ ${additionalLanguages.length} translated version${additionalLanguages.length === 1 ? '' : 's'}: ${additionalLanguages.join(', ')})`
        : '';
    console.log(`index.html regenerated from portal data${suffix}.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
