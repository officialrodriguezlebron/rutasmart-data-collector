# Phase 2 UI — Route Split + Map Dashboard + Visual Polish

**Date:** 2026-06-14  
**Status:** Approved for implementation  
**Project:** RutaSmart (thesis) — rutas-frontend (React PWA, Vercel)

---

## 1. Goal

Split the monolithic `AdminDashboard.jsx` into proper React Router nested routes, introduce a two-section sidebar (OPERATIONS / RESEARCH), add a full-screen Map Dashboard as the operational hero page, and add inline SVG chart visualizations to Overview and Corridors pages.

No new backend endpoints required. No new npm dependencies (Leaflet already installed).

---

## 2. Architecture

### 2.1 Current state

`/admin` → single `<AdminDashboard />` component. All pages are inline tab components inside one 900-line file. No deep-linking — URL never changes between tabs.

### 2.2 Target state

`/admin/*` → `<AdminShell />` layout with `<Outlet />`. Each section is a dedicated page component under `src/pages/admin/`. URL reflects the active page.

```
/admin              → redirect → /admin/overview
/admin/overview     → AdminOverview
/admin/map          → AdminMap          ← new hero page
/admin/trips        → AdminTrips
/admin/corridors    → AdminCorridors
/admin/zones        → AdminZoneMgmt
/admin/stop-zones   → AdminStopZones
/admin/research     → AdminResearch
/admin/conductors   → AdminConductors
```

### 2.3 File structure

```
rutas-frontend/src/pages/admin/
  AdminShell.jsx          ← new: sidebar nav + <Outlet>
  AdminOverview.jsx       ← extracted from Overview() + sparklines
  AdminMap.jsx            ← NEW: full-screen Leaflet map dashboard
  AdminTrips.jsx          ← extracted from TripsTab(), no visual changes
  AdminCorridors.jsx      ← extracted from AggregateTab() + SVG charts
  AdminZoneMgmt.jsx       ← StopZoneManagement.jsx moved/re-exported here
  AdminStopZones.jsx      ← extracted from PublishStopZonesPanel()
  AdminResearch.jsx       ← extracted from AnalyticsTab()
  AdminConductors.jsx     ← extracted from ConductorsTab()
```

`AdminDashboard.jsx` becomes a redirect shim:
```jsx
// pages/AdminDashboard.jsx  (keep for backward compat with App.jsx during transition)
export { default } from "./admin/AdminShell";
```

### 2.4 App.jsx changes

Replace the single `/admin` route with nested routes:

```jsx
import AdminShell       from "./pages/admin/AdminShell";
import AdminOverview    from "./pages/admin/AdminOverview";
import AdminMap         from "./pages/admin/AdminMap";
import AdminTrips       from "./pages/admin/AdminTrips";
import AdminCorridors   from "./pages/admin/AdminCorridors";
import AdminZoneMgmt    from "./pages/admin/AdminZoneMgmt";
import AdminStopZones   from "./pages/admin/AdminStopZones";
import AdminResearch    from "./pages/admin/AdminResearch";
import AdminConductors  from "./pages/admin/AdminConductors";

// In <Routes>:
<Route path="/admin" element={<RequireAdmin><AdminShell /></RequireAdmin>}>
  <Route index element={<Navigate to="overview" replace />} />
  <Route path="overview"    element={<AdminOverview />} />
  <Route path="map"         element={<AdminMap />} />
  <Route path="trips"       element={<AdminTrips />} />
  <Route path="corridors"   element={<AdminCorridors />} />
  <Route path="zones"       element={<AdminZoneMgmt />} />
  <Route path="stop-zones"  element={<AdminStopZones />} />
  <Route path="research"    element={<AdminResearch />} />
  <Route path="conductors"  element={<AdminConductors />} />
</Route>
```

---

## 3. AdminShell.jsx

Persistent left sidebar + `<Outlet />`. Replaces the current top-bar + tab-button nav.

### 3.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│ ┌────────────┐ ┌───────────────────────────────────┐   │
│ │ RutaSmart  │ │                                   │   │
│ │ ─────────  │ │        <Outlet />                 │   │
│ │ OPERATIONS │ │                                   │   │
│ │  🗺 Map    │ │                                   │   │
│ │  ⊞ Overview│ │                                   │   │
│ │  🚌 Trips  │ │                                   │   │
│ │  📊 Corrids│ │                                   │   │
│ │  📍 Zones  │ │                                   │   │
│ │            │ │                                   │   │
│ │ RESEARCH   │ │                                   │   │
│ │  🔬 Research│ │                                  │   │
│ │  🗂 Stop Det│ │                                  │   │
│ │            │ │                                   │   │
│ │ ─────────  │ │                                   │   │
│ │  👤 Conduct│ │                                   │   │
│ │  [Sign out]│ │                                   │   │
│ └────────────┘ └───────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Sidebar spec

- **Width:** 200px fixed, full viewport height, `position: fixed; left: 0; top: 0`
- **Background:** `rgba(255,255,255,0.06)` + `border-right: 1px solid rgba(255,255,255,0.10)` — matches existing glass aesthetic
- **Main content:** `margin-left: 200px`, fills remaining width
- **Section labels:** `OPERATIONS` / `RESEARCH` — `font-size: 10px`, `font-weight: 800`, `color: rgba(255,255,255,0.30)`, `text-transform: uppercase`, `letter-spacing: 0.12em` — matches existing label style in AdminDashboard
- **Nav items:** Use `<NavLink>` from react-router-dom. Active state: `border-left: 3px solid #42a5f5` + `background: rgba(66,165,245,0.10)`. Inactive: no border, `color: rgba(255,255,255,0.60)`
- **Divider:** `border-top: 1px solid rgba(255,255,255,0.10)` before Conductors
- **Sign out:** plain button at bottom, same style as current sign-out button
- **No mobile hamburger** — admin PWA is tablet/desktop only

### 3.3 Nav items

```
OPERATIONS
  🗺  Map          → /admin/map
  ⊞  Overview     → /admin/overview
  🚌  Trips        → /admin/trips
  📊  Corridors    → /admin/corridors
  📍  Zones        → /admin/zones

RESEARCH
  🔬  Research     → /admin/research
  🗂  Stop Detect  → /admin/stop-zones

──────────────────
  👤  Conductors   → /admin/conductors
  [Sign out]
```

### 3.4 Data fetching

AdminShell does **not** fetch data. Each child page fetches its own data on mount. This eliminates the current prop-drilling pattern and means pages only load what they need.

Shared across pages: `authService` (already a singleton). No React context needed for Phase 2.

---

## 4. AdminMap.jsx (New Hero Page)

### 4.1 Purpose

Full-screen operational map showing published stop zones for the MR-001 corridor. The first thing an operator sees when they want to understand current stop coverage.

### 4.2 Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Map Dashboard          [Malanday→Recto ▾] [Recto→Malanday]│
├────────────────────────────────┬────────────────────────────┤
│                                │  ┌────────┐ ┌────────┐    │
│                                │  │   32   │ │  87%   │    │
│       LEAFLET MAP              │  │ Zones  │ │Signal  │    │
│                                │  └────────┘ └────────┘    │
│  Published zones as pins       │  ┌────────┐ ┌────────┐    │
│  Color-coded by demand tier    │  │  High  │ │   20   │    │
│  Corridor polyline             │  │ Demand │ │ Trips  │    │
│                                │  └────────┘ └────────┘    │
│                                ├────────────────────────────┤
│                                │  ZONE LIST (scrollable)    │
│                                │  ● Malabon Rotunda   High  │
│                                │  ● Monumento         High  │
│                                │  ● Caloocan City     Med   │
│                                │  ...                       │
├────────────────────────────────┴────────────────────────────┤
│  LEGEND:  ● High  ● Medium  ● Low    ── Corridor path       │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Map behavior

- **Data:** `getPublishedStops("MR-001", direction)` — already in `api.js`
- **Direction toggle:** Two tab buttons (Malanday→Recto / Recto→Malanday). Switching refetches and re-renders map. `key={direction}` on `<MapContainer>` to force remount (same pattern as TripMap.jsx)
- **Stop zone pins:** `<CircleMarker>` colored by demand tier using existing `DEMAND_COLOR` (`#ff453a` High, `#ffd60a` Medium, `#30d158` Low). Radius 10, fillOpacity 0.8
- **Popup on click:** Zone name, demand tier chip, confidence chip, recommendation text — reuse `Chip` component from StopZoneManagement
- **Corridor polyline:** Draw from published zone centroids sorted by latitude (ascending for MR, descending for RM). `<Polyline>` with color `#42a5f5` for MR, `#00b4d8` for RM, opacity 0.5
- **Auto-fit:** `map.fitBounds(bounds)` on data load via `useMap()` hook inside a child component
- **Map height:** `calc(100vh - 200px)` — fills the page minus header and legend strip

### 4.4 Right panel

- **4 summary cards:** Published Zones count, Avg Signal Quality (avg good_pct across trip summaries, fetched from `getAdminStats`), High Demand zones count, Total Trips count
- **Zone list:** Scrollable list below cards. Each row: colored dot + name + demand tier chip. Clicking a row: `map.flyTo([lat, lon], 16)` via a shared ref

### 4.5 Empty state

If no zones published: centered message "No stop zones published yet. Go to Stop Detection to publish zones for this corridor." with a link to `/admin/stop-zones`.

### 4.6 Data sources (no new endpoints)

| Data | Source |
|---|---|
| Zones (lat, lon, demand_tier, name, confidence, recommendation) | `getStopZoneRecommendations("MR-001", direction)` — already returns centroid lat/lon + GT-matched name |
| Stats strip (total_trips, published zone count) | `getAdminStats()` |

`getStopZoneRecommendations` is preferred over `getPublishedStops` for the map because it already includes the GT-matched zone name, confidence, and recommendation text needed for the popup — no additional client-side GT matching required.

---

## 5. AdminOverview.jsx

Extracted from `Overview()` in `AdminDashboard.jsx` with sparkline additions.

### 5.1 What stays the same

- 4 north-star KPI cards (Total Passengers, Utilization Rate, Most Active Stop, Least Active Stop)
- Stop Zone Intelligence 4-card row
- Recent Trips table (last 5 trips)

### 5.2 Sparklines (inline SVG)

Added to **Total Passengers** and **Utilization Rate** KPI cards only. Data source: last 7 trip-days from `aggregate.trip_summaries`, aggregated by PHT date.

```jsx
function Sparkline({ values, color }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) =>
    `${(i / Math.max(values.length - 1, 1)) * 60},${20 - (v / max) * 18}`
  ).join(" ");
  return (
    <svg width="60" height="20" style={{ display: "block", marginTop: 4 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

- Total Passengers sparkline: sum of `occupancy_count` per trip-day — derived from `trip_summaries` (each has `log_count` as proxy). Color `#bf5af2`
- Utilization Rate sparkline: avg `avg_load_factor_pct` per trip-day. Color: adaptive (green/amber/red)
- Most/Least Active Stop cards: no sparkline — name display only

### 5.3 Stop Zone Intelligence — progress rings

Replace 4 flat metric cards with 2 donut progress rings (inline SVG) + 2 plain cards:

```
[ Donut: MR zones / 70 GT ]  [ Donut: RM zones / 70 GT ]
[ Published Stop Zones: 32 ]  [ Trips Analyzed: 20      ]
```

Donut ring: SVG `<circle>` with `stroke-dasharray` = `(zone_count / 70) * circumference`. Color matches corridor color (`#42a5f5` MR, `#00b4d8` RM).

---

## 6. AdminCorridors.jsx

Extracted from `AggregateTab()` with chart replacements.

### 6.1 Time distribution — stacked single bar

Replace 4 separate bar rows with one horizontal stacked bar showing all periods proportionally:

```
Morning Peak ████  Midday ████████  Afternoon Peak ████  Off-Peak ██
```

```jsx
function StackedBar({ distribution, colorMap }) {
  const total = Object.values(distribution).reduce((s, c) => s + c, 0) || 1;
  return (
    <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden" }}>
      {Object.entries(distribution).map(([period, count]) => (
        <div key={period}
          style={{ width: `${(count / total) * 100}%`, background: colorMap[period] }}
          title={`${period}: ${count}`}
        />
      ))}
    </div>
  );
}
```

Legend below the bar (period name + color dot + count).

### 6.2 Demand distribution — donut chart

Replace 3–4 bar rows with a single SVG donut. Segments: Low Demand, Medium Demand, High Demand (Critical merged into High per Phase 1 labels).

```jsx
function DonutChart({ segments, size = 80 }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = 28; const cx = size / 2; const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size}>
      {segments.map(seg => {
        const dash = (seg.value / total) * circumference;
        const el = (
          <circle key={seg.label} cx={cx} cy={cy} r={r}
            fill="none" stroke={seg.color} strokeWidth="12"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
          />
        );
        offset += dash;
        return el;
      })}
      <circle cx={cx} cy={cy} r={22} fill="var(--color-background)" />
    </svg>
  );
}
```

### 6.3 Trip summaries table — quality visual column

Keep the `Signal Quality` column header (Phase 1 rename — do not change). Add a 60px inline mini-bar below the percentage value in each cell:

```jsx
<td>
  <span style={{ fontWeight: 700, color: gp != null ? goodColor(gp) : "#8e9ab0" }}>
    {gp != null ? `${gp.toFixed(1)}%` : "—"}
  </span>
  <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 99, marginTop: 3 }}>
    {gp != null && <div style={{ height: "100%", width: `${gp}%`, background: goodColor(gp), borderRadius: 99 }} />}
  </div>
</td>
```

The number stays visible; the bar adds a visual layer below it. Column header remains `Signal Quality`.

### 6.4 By-corridor section

No change — existing bar rows are already well-suited for this data.

---

## 7. Extracted Pages (no visual changes)

These pages are extracted verbatim from their inline components in `AdminDashboard.jsx`. No visual or behavioral changes — extraction only.

| New file | Extracted from | Notes |
|---|---|---|
| `AdminTrips.jsx` | `TripsTab()` | Unchanged |
| `AdminStopZones.jsx` | `PublishStopZonesPanel()` | Unchanged |
| `AdminResearch.jsx` | `AnalyticsTab()` | Unchanged |
| `AdminConductors.jsx` | `ConductorsTab()` | Unchanged |
| `AdminZoneMgmt.jsx` | `StopZoneManagement.jsx` | Move + rename, no changes |

Each extracted page:
- Gets its own `useEffect` data fetch (replacing prop-passed data)
- Imports needed API calls from `../services/api`
- Imports shared helpers (`dirLabel`, `phtDateStr`, `goodColor`, etc.) — move these to a new `src/utils/formatters.js` shared util file

---

## 8. Shared Utilities (src/utils/formatters.js)

Move the following helpers out of AdminDashboard.jsx into a shared file so all admin pages can import them:

```js
export const goodColor   = (v) => v >= 88 ? "#30d158" : v >= 78 ? "#ffd60a" : "#ff453a";
export const statusColor = (s) => s === "ACTIVE" ? "#30d158" : s === "COMPLETED" ? "#42a5f5" : "#8e9ab0";
export const dirLabel    = (d) => d === "MALANDAY-RECTO" ? "Malanday → Recto" : d === "RECTO-MALANDAY" ? "Recto → Malanday" : (d || "—");
// Copy phtDateStr, phtTimeStr, periodColor, periodColorCard verbatim from AdminDashboard.jsx lines 64–75
```

All functions are copied verbatim from `AdminDashboard.jsx` — do not rewrite them.

---

## 9. Implementation Order

1. Create `src/utils/formatters.js` — move shared helpers
2. Create `src/pages/admin/` directory
3. Extract verbatim pages (AdminTrips, AdminStopZones, AdminResearch, AdminConductors, AdminZoneMgmt) — each with own data fetch
4. Build `AdminShell.jsx` — sidebar + `<Outlet>`
5. Update `App.jsx` — nested routes
6. Build `AdminOverview.jsx` — extracted + sparklines + progress rings
7. Build `AdminCorridors.jsx` — extracted + stacked bar + donut + quality column
8. Build `AdminMap.jsx` — new Leaflet map hero page
9. Retire `AdminDashboard.jsx` content (keep as re-export shim for 1 commit, then fully remove)
10. QA: verify all routes work, deep-linking works, no prop-drilling regressions

---

## 10. Constraints & Guardrails

- **No new npm packages** — all charts use inline SVG, Leaflet already installed
- **No backend changes** — all data comes from existing endpoints
- **AdminDashboard.css stays** — shared class names work across all extracted pages
- **`authService.getHomeRoute()`** must still return `/admin` — AdminShell handles the index redirect to `/admin/overview`
- **AnalyticsEngine.jsx stays** at `/analytics` — separate route for conductors/analysts; Research tab in admin sidebar links to `/admin/research` (a simpler summary view, not the full engine)
- **Phase 1 terminology** preserved throughout — do not reintroduce DBSCAN, "GOOD %", "Logs", "Aggregate" labels
