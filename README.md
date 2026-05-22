# Enrollment Intelligence Dashboard

A longitudinal enrollment tracking dashboard for graduate programs. Drop biweekly snapshot files in, watch trends emerge over time, catch melt events the moment they happen.

## What it does

This dashboard ingests `Enrollment_YYYY-MM-DD.xlsx` snapshot files and turns them into a unified longitudinal view. Each upload becomes a point on the time series. The dashboard surfaces:

- Current state per program with variance against target
- Multi snapshot trend lines per program for matriculated, pending applicants, and variance
- Period over period change analysis
- Melt event log (any drop in matriculated count between snapshots)
- Variance vs target visualization
- Data quality alerts for files with filename and internal header date mismatches

All snapshot data is persisted in browser `localStorage`, so the time series survives across sessions on the same browser.

## Screenshots

Add screenshots once deployed (see Deployment section).

## Tech stack

- React 18
- Vite 5
- Tailwind CSS 3
- Recharts (charts)
- SheetJS (in browser Excel parsing)
- lucide-react (icons)

No backend, no database, no server. Everything runs client side. Uploaded Excel files are parsed in the browser and never leave the page.

## Run locally

Prerequisites: Node.js 18 or later, npm.

```bash
git clone https://github.com/YOUR_USERNAME/enrollment-dashboard.git
cd enrollment-dashboard
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`).

## Build for production

```bash
npm run build
```

Output goes to `dist/`. You can serve this folder from any static host.

```bash
npm run preview
```

Serves the production build locally to verify before deploying.

## Deployment

### Option A: GitHub Pages (free, included)

A workflow at `.github/workflows/deploy.yml` builds and deploys on every push to `main`.

1. Push this repo to GitHub.
2. In repo settings, go to **Settings → Pages**.
3. Under **Source**, select **GitHub Actions**.
4. Push a commit (or re run the workflow from the Actions tab).
5. Your dashboard will be live at `https://YOUR_USERNAME.github.io/REPO_NAME/`.

The workflow automatically sets the correct base path for GitHub Pages using the repo name.

### Option B: Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. Import the repo. Vercel auto detects Vite settings.
3. Click Deploy. You get a `*.vercel.app` URL within seconds.

### Option C: Netlify

1. Sign in at [netlify.com](https://netlify.com) with GitHub.
2. Import the repo. Build command: `npm run build`. Publish directory: `dist`.
3. Deploy.

## How to use

The dashboard ships with 18 seed snapshots from the FY27 cycle (March 9 to May 22, 2026) as a working example. To start tracking your own data:

1. Open the dashboard.
2. Scroll to the **Add New Snapshot** card at the bottom.
3. Drag and drop `Enrollment_YYYY-MM-DD.xlsx` files, or click to browse.
4. The dashboard parses each file in the browser and writes the snapshot to `localStorage`.
5. Trend, change, and melt analysis update automatically.

### Expected Excel format

The parser expects the standard biweekly template:

| Column | Content |
|--------|---------|
| A | Date header in row 1 (`Date: YYYY-MM-DD`), then program names from row 3 |
| B | Matriculated (Summer) |
| C | Matriculated (Fall) |
| D | Total Matriculated |
| E | Admitted but not matriculated (Summer) |
| F | Admitted but not matriculated (Fall) |
| G | Total Admitted but not matriculated |
| H | (empty separator) |
| I | Target in budget |
| J | Variance |
| K | Buffer (optional, only on Total row) |

The parser is schema flexible. It handles files missing the Target/Variance columns (it backfills from known later snapshots) and files missing the Buffer column.

### Resetting

The **Reset** button in the Snapshot Archive card wipes all stored snapshots and reloads the 18 seed snapshots. Use this if you want a fresh start.

To remove individual snapshots, click the trash icon next to any entry in the Snapshot Archive.

## Protecting admin features (upload and archive)

By default, the dashboard ships with admin features **hidden from everyone**. The dashboard renders a read only view: KPIs, current state, trends, change analysis, and melt log are visible to all viewers, but the Add New Snapshot card and the Snapshot Archive (with delete buttons) do not appear at all.

To unlock admin features for yourself, configure a password.

### Step 1. Generate a hash of your password

Pick a strong password (16+ characters, random is best). Then:

```bash
node scripts/hash-password.js "your-strong-password-here"
```

This prints a 64 character hex hash. Your plaintext password never leaves your machine.

### Step 2. Paste the hash into the config file

Open `src/config.js` and replace the empty string with your hash:

```js
export const ADMIN_PASSWORD_HASH = 'a1b2c3...your-64-char-hex-here...'
```

### Step 3. Commit and deploy

After redeploying, a lock icon appears in the dashboard header. Click it, enter your password, and the upload and archive sections become visible. Your admin session lasts until you close the browser tab (session storage, not local storage).

To lock yourself out again, click the "Admin" badge that appears in the header when unlocked.

### Security model

This is **casual protection**, not real authentication. The hash gate prevents accidental tampering by random viewers and stops anyone who doesn't know the password from using the upload UI through the normal interface.

What it does NOT protect against:

- A determined viewer with browser dev tools can inject JavaScript to bypass the check.
- Your hash is visible in the deployed JavaScript bundle, so a weak password could be brute forced offline.
- The snapshot data embedded in `src/lib/seedData.js` is always public. Only the upload UI and archive management are gated.
- Anyone can edit their own local `localStorage` directly through dev tools.

For enrollment numbers that aren't truly secret (sensitive but not regulated), this is appropriate. For PII or anything subject to FERPA, HIPAA, or similar, you'd need a real backend with proper authentication. I can sketch what that would look like if you need it.

To minimize risk:

- Use a long random password (a password manager will pick a good one).
- Rotate the hash if you suspect compromise (regenerate, commit, redeploy).
- Don't rely on this gate to protect anything truly sensitive.

### Replace the seed data

The 18 seed snapshots live in `src/lib/seedData.js`. To replace them with your own historical data:

1. Edit `seedData.js` to contain your own snapshot objects following the same shape.
2. Rebuild and redeploy.

Or just delete the seed entries and let users start with an empty dashboard.

## Project structure

```
enrollment-dashboard/
├── .github/workflows/deploy.yml    GitHub Pages deploy workflow
├── public/favicon.svg
├── scripts/
│   └── hash-password.js            Helper to hash your admin password
├── src/
│   ├── lib/
│   │   ├── storage.js              localStorage adapter
│   │   └── seedData.js             18 seed snapshots
│   ├── EnrollmentDashboard.jsx     Main dashboard component
│   ├── App.jsx
│   ├── main.jsx
│   ├── config.js                   Admin password hash goes here
│   └── index.css
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.js
├── LICENSE
└── README.md
```

## Data model

Each snapshot in `localStorage` is keyed `edash:snapshot:YYYY-MM-DD` and holds a JSON object:

```js
{
  date: "2026-05-22",
  sourceFile: "Enrollment_2026-05-22.xlsx",
  dataQualityNote: "",
  rows: [
    { program: "APPH", matSummer: 1, matFall: 14, matTotal: 15,
      admSummer: 5, admFall: 4, admTotal: 9,
      target: 13, variance: 2, buffer: null },
    // ... one row per program (including Total)
  ]
}
```

This is the **tidy data** pattern formalized by Wickham (2014, *Journal of Statistical Software*, vol. 59 issue 10). Each observation is identified by (snapshot_date, program, metric), which makes any pivot, trend, or delta a derived view rather than something to maintain by hand.

## Privacy

Excel parsing happens entirely in the browser using SheetJS. Uploaded files are never sent to any server. Stored data lives in your browser's `localStorage` only.

## License

MIT. See [LICENSE](LICENSE).
