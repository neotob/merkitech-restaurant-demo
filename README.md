# Merki Tech — Essentials Starter Template

Reusable starting point for the **Essentials (static)** package — see `merkitech.com`'s
`CLAUDE.md` for the full pricing/positioning context. This repo is meant to be cloned per client,
not edited in place and reused directly.

Currently filled in with placeholder content for a fictional restaurant ("Aloha Plate Kitchen")
as a working example — replace everything client-specific before delivering.

## Starting a new client project

1. On GitHub, use **"Use this template"** (or clone + re-init git) to create a new repo per client
   — don't just branch off this one, each client should be its own independent repo.
2. Work through the customization checklist below.
3. Connect the new repo to Cloudflare (steps further down) and preview before going live.

## Customization checklist

- [ ] `<title>`, meta description, `og:title`/`og:description` in `<head>`
- [ ] JSON-LD block — business name, `url`, cuisine/category, full address, phone, price range,
      and `openingHoursSpecification` (keep in sync with the visible Hours & Location section —
      it's two places listing the same hours, unless this client is wired to the portal, see
      below). Add `image` once a real client photo exists and `sameAs` (social profile URLs) once
      known; don't fill either with placeholders.
- [ ] `<link rel="canonical">` — the real domain, once known
- [ ] Cloudflare Web Analytics — register this site at dash.cloudflare.com → Analytics & Logs →
      Web Analytics → Add site, then replace the `data-cf-beacon` token in `<head>` with the one
      it gives you (each site/domain needs its own token). Free, cookie-less, no consent banner.
- [ ] Logo text in the header (`.logo`) and hero heading/subheading copy
- [ ] "Our Story" copy in the About section (`#about`) — and swap the generated `.about-photo`
      SVG illustration for a real `<img>` once a client photo is available
- [ ] Menu items, prices, and descriptions — grouped under the `data-category` values used by
      the filter pills (`plates`, `starters`, `desserts`, `drinks`; rename/add categories in both
      the `.menu-filter` buttons and each `.menu-item`'s `data-category` to match). **Skip this
      step entirely if the client is wired to the Merki Tech portal** — categories and items are
      then maintained there and regenerated into this file instead; see `CLAUDE.md`'s
      "Portal-driven content" section.
- [ ] Hours and location (address, phone) — same portal exception as above for the hours table
      and JSON-LD `openingHoursSpecification` specifically; location/phone are always hand-edited
      regardless.
- [ ] Contact form backend — **register the client's live domain in `merkitech.com`'s
      `relay/clients.json`** (`hostname -> {"to": "...", "business": "..."}`), commit, push — that's
      the whole setup, no per-client key or external account. The form already posts to
      `https://www.merkitech.com/relay/submit.php`, a shared PHP endpoint on Merki Tech's own
      hosting; see that repo's README ("Contact relay for client sites") for how it works.
      (Alternative: point the form's `action` at [Web3Forms](https://web3forms.com/) instead, with
      a fresh free key per client — an option if this relay is ever unreachable, but currently
      unused by this template.)
- [ ] Colors — the `:root` CSS variables at the top of the `<style>` block
      (`--primary-1`, `--primary-2`, `--primary-solid`, `--dark`, `--bg-alt`) are the fastest way
      to reskin for a new brand without touching the rest of the CSS. Also update
      `--primary-solid-rgb` (the same color as `--primary-solid`, as `r, g, b`) — it's used for the
      form focus-ring's `rgba()` opacity, which can't reference `--primary-solid`'s hex value
      directly.
- [ ] `favicon.png` — replace the generic Merki Tech "M" placeholder with the client's actual
      favicon (so a forgotten step fails visibly instead of a client site shipping a blank/broken
      tab icon)
- [ ] `robots.txt` and `sitemap.xml` — replace `example.com` with the real domain
- [ ] Remove or update this README before handing off, if the client will ever see the repo

## Deploying to Cloudflare

**Heads up**: this repo's own first deploy landed as a **Worker with static assets**, not a
classic Pages project — Cloudflare's "Connect to Git" flow under Workers & Pages now defaults
new projects to Workers rather than Pages, even though the product is still branded "Workers &
Pages" in the sidebar. Functionally equivalent for a static site (free tier, git-connected
auto-deploy, custom domains), but the dashboard screens and API endpoints differ from the
classic Pages docs — don't be surprised if it doesn't show up under a Pages-specific API call or
guide.

1. In the Cloudflare dashboard: **Workers & Pages → Create application**, connect the new client
   repo. No build command needed for plain static HTML.
2. Cloudflare auto-deploys on every push to the connected branch from then on.
3. **Custom domain**: open the deployed application → **Settings → Domains & Routes → Add** →
   enter the client's domain (or a subdomain, e.g. `demo.merkitech.com` — this template's own
   live preview, confirmed working this way). If the domain's DNS already lives on Cloudflare
   under the same account, this attaches the domain directly to the Worker without needing a
   separate manual DNS record.
   - Via API instead: `PUT /accounts/{account_id}/workers/domains` with
     `{"hostname": "...", "service": "<script-name>", "environment": "production", "zone_id": "..."}`
     — this is what actually worked for `demo.merkitech.com`, confirmed via the Workers API, not
     the Pages API (`/accounts/{account_id}/pages/projects` returns nothing for a
     Workers-with-assets deployment, even though the account and everything else is correct).

## Why static instead of WordPress for this tier

No CMS, no database, no plugin/security-patch surface — which is exactly why this tier can
honestly offer $0/mo *hosting* (Cloudflare's free tier) where the WordPress tier can't. Domain
registration is still a real cost regardless of tier, though — don't imply "$0/mo" covers the
whole picture when quoting a client.

## Current pricing for this tier (keep in sync with merkitech.com)

These numbers live in three places — `merkitech.com/index.html` (the live calculator),
`merkitech.com/checklist.html` (the customer-facing version), and `merkitech.com/CLAUDE.md` (the
full reference table) — this file is a fourth, so if pricing changes, update all four or this
README will drift stale exactly like it just did.

| Item | Price |
|---|---|
| Base build | $900 one-time |
| Reservations/ordering integration | +$750 |
| Online gift cards/merch store | +$1,200 |
| Additional languages | +$300–$1,000/language (machine/mixed/human) |
| Business email — forwarding setup | +$50 one-time |
| Business email — full mailbox setup | +$100 one-time (+ ~$6–12/mo billed by the email provider) |
| Google Business Profile setup | +$75 one-time (includes a review-page QR code; video verification must be done by the client) |
| Local directory listings (Yelp, TripAdvisor, Apple Maps, Bing Places) | +$100 one-time |
| **Domain only** (required) | **$10/mo** |
| **Domain + content updates** (optional, includes domain) | **$49/mo**, up to 2 small changes/month |

Reservations/store add-ons also imply their own third-party subscription (booking platform
~$49–58/mo, store platform varies) billed separately by whichever platform the client picks —
not through Merki Tech.
