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

## Linking to the app

The Sign in / Start free buttons currently point at:

- `/login`
- `/signup`

If the landing page lives on a different subdomain than the app
(e.g. `stockbolt.com` for landing, `app.stockbolt.com` for the app), change the
hrefs to the absolute URLs like `https://app.stockbolt.com/signup`. Search for
`/signup` in the HTML — there are 3 spots (hero, auto-parts CTA, final CTA banner)
plus one each for `/login` in the nav and footer.

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
