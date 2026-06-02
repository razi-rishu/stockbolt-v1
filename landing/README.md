# StockBolt landing page

A single-file static landing page. No build step, no dependencies — just one HTML
file with all CSS and JS inlined. Drag the file anywhere that serves static
content and you have a working marketing site.

## Local preview

Just double-click `index.html`. Or, from the project root:

```powershell
# Windows / PowerShell
start E:\stockbolt_clean\stockbolt-v1\landing\index.html
```

Or serve it on a port if you want to test mobile responsiveness from another
device on your network:

```powershell
# Requires Python (pre-installed on most dev machines)
cd E:\stockbolt_clean\stockbolt-v1\landing
python -m http.server 8000
# then open http://localhost:8000 in any browser
```

## Deploy options (in increasing order of effort)

### 1. Netlify Drop — easiest, 30 seconds

1. Go to https://app.netlify.com/drop
2. Drag the entire `landing` folder onto the page
3. You get a `https://random-name-12345.netlify.app` URL immediately
4. Optional: claim it under your Netlify account to add a custom domain later

### 2. Vercel — best if you already use it

```powershell
cd E:\stockbolt_clean\stockbolt-v1\landing
npx vercel
# follow prompts, accept defaults
```

You'll get a Vercel URL. Point your `stockbolt.com` (or whatever domain) at the
Vercel project later.

### 3. GitHub Pages — free, integrates with your repo

1. Push the repo to GitHub (already done — the file is committed)
2. In the GitHub repo, go to **Settings → Pages**
3. Source: **Deploy from a branch**, Branch: `main`, Folder: `/landing`
4. Save. After a few minutes you get `https://razi-rishu.github.io/stockbolt-v1/`

### 4. Cloudflare Pages — also free, slightly faster CDN

Connect the GitHub repo. Set:
- Build command: *(leave blank)*
- Build output directory: `landing`

## Editing copy

All text is in plain HTML in `index.html`. To change the hero headline, search
for `<h1>` and edit. To change FAQ answers, look for `class="faq-a"`. The
features section uses `<div class="feature">` blocks — copy one and edit to
add a 7th feature.

## Two ways the landing page lives in your project

### A. In-app at `/` and `/landing` (Phase 14.14c — the default now)

The landing page is also wired as a proper React route inside the Vite app:

| URL | Who sees what |
|-----|---------------|
| `localhost:5173/` (anonymous)       | Renders the landing page |
| `localhost:5173/` (logged in)       | Redirects to `/dashboard` |
| `localhost:5173/landing` (anyone)   | Always renders the landing page (handy for previewing copy while logged in) |

Source: `src/modules/marketing/landing-page.tsx` (+ `landing-page.css`).

This is what you'll use for local development and most deployments —
no separate hosting, no CORS, CTAs are React Router `<Link>` so they
client-side-navigate without a page reload.

### B. Standalone static page in `landing/` (this folder)

The file you're reading also exists as a self-contained `index.html` you can
deploy to a separate marketing subdomain (e.g. `stockbolt.com`) while the
app sits at `app.stockbolt.com`. Useful for SEO, faster TTFB on the marketing
side, and editing copy without touching the React app.

Keep this file in rough sync with `src/modules/marketing/landing-page.tsx`
when marketing copy changes.

## Linking to the app

The Sign in / Start free buttons are wired up automatically based on where the
landing page is being served from:

| Where the landing page is loaded | CTA links go to |
|----------------------------------|-----------------|
| `file://…/index.html` (double-clicked locally) | `http://localhost:5173/login` and `/register` |
| `http://localhost:8000` (Python http.server) | `http://localhost:5173/login` and `/register` |
| Any other domain (Netlify, Vercel, prod) | Same-domain relative `/login` and `/register` |

So you can double-click the file and the buttons take you straight to your
running Vite dev server. No manual edits.

### Overriding for previews

Add `?app=https://...` to the landing URL to point CTAs at a specific
environment. Examples:

```
file:///E:/stockbolt_clean/stockbolt-v1/landing/index.html?app=http://localhost:5173
https://staging.stockbolt.com/?app=https://app-staging.stockbolt.com
```

### When you have a final production URL

Open `index.html`, search for `APP_BASE_PROD`, and set it to your production
app URL (e.g. `https://app.stockbolt.com`). Save. From then on, the production
landing page sends visitors to the right place without any per-link edits.

```js
var APP_BASE_PROD = 'https://app.stockbolt.com';   // ← set this when ready
```

## Brand alignment

Colours and typography match the app's design tokens (`src/ui/theme.ts`):

- Indigo primary: `#6366f1` / deep: `#4f46e5` / soft: `#eef2ff`
- Ink: `#0f172a` / secondary: `#475569` / tertiary: `#94a3b8`
- Line: `#e2e8f0`
- Font: Inter (loaded from Google Fonts, with Instrument Serif used for the
  italic accent in the hero headline)
- Logo bolt: same SVG path as the in-app header (`M13 2 3 14h7l-1 8 10-12h-7l1-8z`)

## What's not in this version

- Pricing section (deferred — add when you finalise tiers)
- Customer logos / testimonials (add when you have referenceable customers)
- Demo video or animated product mock (a 30-second screen capture in the hero
  would lift this a lot once the app is ready to show off)
- Blog / docs (separate project when needed)
