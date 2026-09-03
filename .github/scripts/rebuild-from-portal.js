// Fetches this client's hours/menu from the Merki Tech portal and regenerates
// the corresponding sections of index.html in place - the JSON-LD
// openingHoursSpecification, the visible hours table, and the menu filter
// pills + grid. See CLAUDE.md for the full design and why this exists.
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
const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

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

// yyyy-mm-dd -> "Nov 28" - parsed as UTC and formatted in UTC so a date string
// from the portal's DATE column never shifts a day under the runner's local
// timezone (a plain `new Date('2026-11-28')` is UTC midnight; formatting it
// with the *local* zone can print the day before west of UTC).
function formatSpecialDate(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', timeZone: 'UTC',
    });
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

// A food truck's day-by-day spot, one line behind that day's hours in the
// same table (not a separate section) - see CLAUDE.md's "Locations" note.
// Since migration 013 (2026-09-04) `row` is a saved Locations-table entry
// (name/address/maps_url), not a freeform string - prefers an exact pinned
// maps_url when the owner set one, otherwise falls back to a Maps search of
// the address, then the name.
function buildLocationLink(row) {
    if (!row.location_name) return '';
    const href = row.location_maps_url || mapsSearchUrl(row.location_address || row.location_name);
    return ` <a class="hours-location" href="${escapeHtml(href)}" target="_blank" rel="noopener">📍 ${escapeHtml(row.location_name)}</a>`;
}

// Per-day location links only render in 'per_day' mode (ClientRepository::
// LOCATION_MODES) - in 'default' mode the one location lives in the
// right-hand Location column instead (see buildLocationBlock()), so
// repeating it on every row would be redundant even though the data might
// still be sitting on some of these rows from before a client switched
// modes.
function buildHoursTableRows(hours, client) {
    const showPerDayLocation = clientHasFeature(client, 'locations') && client.location_mode === 'per_day';
    return DAY_ORDER.map(day => {
        const row = hours[day];
        const value = isClosed(row) ? 'Closed' : `${formatClockTime(row.open_time)} – ${formatClockTime(row.close_time)}`;
        const locationPart = showPerDayLocation ? buildLocationLink(row) : '';
        return `                            <tr data-day="${day}"><td>${DAY_LABELS[day]}</td><td>${value}${locationPart}</td></tr>`;
    }).join('\n');
}

// yyyy-mm-dd -> 'mon'/'tue'/etc, computed in UTC so it can't shift a day
// under the runner's local timezone - same reasoning as formatSpecialDate
// just above. Used to tie a special-hours row back to its regular-hours
// row client-side (see the "highlight this week's special hours" script).
const DOW_SLUGS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function dayOfWeekSlug(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return DOW_SLUGS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
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
// validThrough pin it to a single day. Bots don't benefit from a "don't show
// it if it's too far out" cutoff the way a human reading the page does, so
// every future-dated entry the portal returns goes in, with no date-range
// filtering here (the portal's own upcomingForClient() already excludes past
// dates). A closed day is expressed as opens/closes both "00:00" rather than
// omitting them - the more broadly-recognized convention for "closed on this
// date" in this schema.
function buildSpecialOpeningHoursSpecification(specialHours) {
    return specialHours.map(entry => ({
        '@type': 'OpeningHoursSpecification',
        validFrom: entry.date,
        validThrough: entry.date,
        opens: isClosed(entry) ? '00:00' : entry.open_time.slice(0, 5),
        closes: isClosed(entry) ? '00:00' : entry.close_time.slice(0, 5),
    }));
}

function buildSpecialHoursSection(specialHours) {
    if (!specialHours.length) return '';

    const rows = specialHours.map(entry => {
        const value = isClosed(entry)
            ? 'Closed'
            : `${formatClockTime(entry.open_time)} – ${formatClockTime(entry.close_time)}`;
        const note = entry.note ? ` <span class="special-hours-note">(${escapeHtml(entry.note)})</span>` : '';
        return `                                <tr data-date="${entry.date}" data-day="${dayOfWeekSlug(entry.date)}"><td>${formatSpecialDate(entry.date)}</td><td>${value}${note}</td></tr>`;
    }).join('\n');

    return `                        <div class="special-hours">
                            <h4>Upcoming hours changes</h4>
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

function formatEventMonth(isoDate) {
    const [y, m] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

// Google requires name/startDate/location for Event rich-result eligibility,
// but an event with no location entered still gets a (non-rich-result-
// eligible) Event object here rather than being dropped outright - still
// valid schema.org, and the location can always be filled in later.
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
// showing one with blank/placeholder text.
function buildEventCard(event) {
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
        event.link_url ? `<a class="event-link" href="${escapeHtml(event.link_url)}" target="_blank" rel="noopener">More info</a>` : null,
    ].filter(Boolean).join('\n                            ');

    return `                    <div class="event-card">
                        <div class="event-date-badge">
                            <span class="day">${formatEventDay(event.event_date)}</span>
                            <span class="month">${formatEventMonth(event.event_date)}</span>
                        </div>
                        <div class="event-details">
                            <h3>${escapeHtml(event.name)}</h3>
                            ${detailLines}
                        </div>
                    </div>`;
}

function buildEventsSection(events) {
    if (!events.length) return '';
    return `                <section class="section" id="events">
                    <div class="container">
                        <h2>Upcoming Events</h2>
                        <div class="events-list">
${events.map(buildEventCard).join('\n')}
                        </div>
                    </div>
                </section>`;
}

function buildMenuFilters(categories) {
    return categories
        .map(cat => `                    <button class="menu-filter" data-filter="${slugify(cat.name)}" aria-pressed="false">${escapeHtml(cat.name)}</button>`)
        .join('\n');
}

function buildMenuGrid(categories) {
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

    function buildCard(item, slugs) {
        return `                    <div class="menu-item" data-category="${[...slugs].join(' ')}">
                        <span class="price">${formatPrice(item.price)}</span>
                        <h4>${escapeHtml(item.name)}</h4>
                        <p>${escapeHtml(item.description || '')}</p>
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

        blocks.push(`                    <h3 class="menu-category-heading" data-category-heading="${slugify(cat.name)}">${escapeHtml(cat.name)}</h3>`);
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

// Content of the second grid column of "Hours & Location" - address/phone
// are portal-managed (added 2026-09-03), not hand-edited HTML. Only reached
// for a client NOT in 'per_day' locations mode (see buildLocationColumn()
// just below, which omits this whole column for that case instead) - so
// this only ever needs to handle 'default' mode (one location, picked from
// the saved Locations list on general.php) and the no-"locations"-feature
// plain address/phone fallback. Only the fields actually filled in appear,
// same "no empty placeholder line" rule as everywhere else in this script.
function buildLocationBlock(client) {
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
    return `<h3>Location</h3>
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
// .info-grid in index.html), no layout class needed here.
function buildLocationColumn(client) {
    if (clientHasFeature(client, 'locations') && client.location_mode === 'per_day') {
        return '';
    }

    return `                    <div>
                        ${buildLocationBlock(client)}
                    </div>`;
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

    let html = fs.readFileSync('index.html', 'utf8');
    html = updateJsonLd(html, hours, specialHours, client);
    html = updateEventsJsonLd(html, events);
    html = replaceBetweenMarkers(html, 'HOURS-TABLE', buildHoursTableRows(hours, client));
    html = replaceBetweenMarkers(html, 'SPECIAL-HOURS', buildSpecialHoursSection(specialHours));
    html = replaceBetweenMarkers(html, 'LOCATION-COLUMN', buildLocationColumn(client));
    html = replaceBetweenMarkers(html, 'EVENTS-SECTION', buildEventsSection(events));
    html = replaceBetweenMarkers(html, 'MENU-FILTERS', buildMenuFilters(menu));
    html = replaceBetweenMarkers(html, 'MENU-GRID', buildMenuGrid(menu));

    fs.writeFileSync('index.html', html);
    console.log('index.html regenerated from portal data.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
