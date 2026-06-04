# WNBA Prop Scout — Mobile App Handoff

**Created:** 2026-05-18  
**Prepared by:** Claude (Cowork)  
**Purpose:** Convert the existing web app into a native iOS/Android mobile app  
**Strategy:** New repo, refactor from web source — backend stays identical

---

## 1. Overview

The web app is a single-page React app (`wnba-prop-scout.jsx`) served by a Vite dev server, backed by an Express.js API (`server.js`) and a Supabase/Postgres database. The mobile app will be a new **React Native (Expo)** project that consumes the same Express API over the network with no changes to the backend.

### What changes

| Layer | Web | Mobile |
|---|---|---|
| UI framework | React + Vite + CSS-in-JS | React Native + Expo + StyleSheet |
| Navigation | CSS tab row (horizontal scroll) | React Navigation bottom tabs + stack |
| Monolithic file | `wnba-prop-scout.jsx` (~4,500 lines) | Split into ~25 screen + component files |
| Styling | Inline style objects + CSS template strings | `StyleSheet.create()` per component |
| Date picker | Custom CSS nav buttons | `@react-native-community/datetimepicker` or Expo equivalent |
| Clipboard copy | `navigator.clipboard` | `expo-clipboard` |
| Notifications | None | `expo-notifications` (injury alerts, lineup lock) |
| Storage/cache | None (stateless) | `@react-native-async-storage/async-storage` |

### What does NOT change

- **`server.js`** — zero modifications needed
- **All `lib/` scoring modules** — not touched
- **All `scripts/`** — not touched  
- **Supabase schema** — not touched
- **API routes** — same URLs, same request/response shapes
- **Environment vars** — `.env` stays on the server; mobile uses `EXPO_PUBLIC_API_BASE`

---

## 2. Recommended Stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Expo SDK 51+** (managed workflow) | Fastest iOS + Android from one codebase; OTA updates; no Xcode/Android Studio required to start |
| Navigation | **React Navigation v6** (`@react-navigation/native`, `bottom-tabs`, `stack`) | Industry standard, works with Expo |
| State | React `useState` / `useContext` — no Redux needed | App state is date-scoped, not deeply nested |
| Data fetching | Native `fetch` (already works in RN) | No library change needed; existing `apiGet*` helpers port as-is |
| Styling | `StyleSheet.create()` + theme constants | Direct port of the `T = { bg, card, accent... }` object |
| Icons | `@expo/vector-icons` (Ionicons / MaterialCommunityIcons) | Bundled with Expo |
| Notifications | `expo-notifications` | Push for injury updates, lineup lock, slate available |
| Clipboard | `expo-clipboard` | Replaces `navigator.clipboard` in copy-summary feature |
| Async storage | `@react-native-async-storage/async-storage` | Cache last-viewed date, user preferences |
| Build / deploy | **EAS Build** (Expo Application Services) | Produces `.ipa` and `.apk`; free tier sufficient to start |

---

## 3. Repo Setup

### Initialize

```bash
npx create-expo-app wnba-prop-scout-mobile --template blank-typescript
cd wnba-prop-scout-mobile
npx expo install react-navigation @react-navigation/native @react-navigation/bottom-tabs @react-navigation/stack
npx expo install react-native-screens react-native-safe-area-context
npx expo install @react-native-async-storage/async-storage
npx expo install expo-clipboard expo-notifications expo-haptics
```

### Environment

Create `app.config.js` (instead of static `app.json`) so env vars can be injected:

```js
// app.config.js
export default {
  expo: {
    name: 'WNBA Prop Scout',
    slug: 'wnba-prop-scout',
    version: '1.0.0',
    extra: {
      apiBase: process.env.EXPO_PUBLIC_API_BASE ?? 'https://your-server.com',
    },
  },
};
```

In code: `import Constants from 'expo-constants'; const API_BASE = Constants.expoConfig.extra.apiBase;`

### `.env` (never commit)

```
EXPO_PUBLIC_API_BASE=https://your-deployed-server.com
```

---

## 4. File Structure

```
wnba-prop-scout-mobile/
├── app.config.js
├── App.tsx                     # Root: navigation container + bottom tabs
├── src/
│   ├── theme.ts                # T = { bg, card, accent, ... } — port from web
│   ├── api.ts                  # All apiGet* / apiPost* helpers — port from web
│   ├── constants.ts            # SEASON, SLATE_LOOKAHEAD_DAYS, TEAM_VENUES, etc.
│   ├── types.ts                # TypeScript interfaces for Game, Pick, Player, etc.
│   │
│   ├── navigation/
│   │   └── TabNavigator.tsx    # Bottom tab bar (5 tabs)
│   │
│   ├── screens/
│   │   ├── GamesScreen.tsx         # GamesTab → game card list
│   │   ├── GameDetailScreen.tsx    # Drilldown: Overview/Lineup/Matchup/Props/Boxscore
│   │   ├── TopPicksScreen.tsx      # TopPicksTab → top picks list
│   │   ├── BoardScreen.tsx         # BoardTab → PTS/REB/AST/3PM subtabs
│   │   ├── AiPicksScreen.tsx       # AiPicksTab → AI narrative picks
│   │   ├── FirstBasketScreen.tsx   # FirstBasketTab
│   │   └── ModelScreen.tsx         # ModelTab → track record stats
│   │
│   ├── components/
│   │   ├── DateNav.tsx             # ← / → date navigator
│   │   ├── PropCard.tsx            # Individual prop pick card (TopPicks + Board)
│   │   ├── GameCard.tsx            # Game summary card (GamesTab)
│   │   ├── EVKellyBar.tsx          # EV + Kelly probability bar from Task AE
│   │   ├── ScoreBreakdown.tsx      # Radar/factor bars
│   │   ├── ClvChip.tsx             # CLV / alt-line chip
│   │   ├── RiskFlags.tsx           # Risk flag pills
│   │   ├── EmptyState.tsx          # Reusable empty/loading state
│   │   ├── SectionHeader.tsx       # Prop-type section header
│   │   ├── FilterBar.tsx           # Prop type / tier filter row
│   │   │
│   │   └── game-detail/
│   │       ├── OverviewPanel.tsx
│   │       ├── LineupPanel.tsx
│   │       ├── MatchupPanel.tsx
│   │       ├── PropsPanel.tsx
│   │       └── BoxscorePanel.tsx
│   │
│   └── hooks/
│       ├── useSlate.ts         # Fetch games for selected date
│       ├── useTopPicks.ts      # Fetch + snapshot top picks
│       ├── useBoard.ts         # Fetch board picks by date
│       └── useDateNav.ts       # Date state + ±1 day handlers
```

---

## 5. Navigation Map

The web app has a horizontal scrolling tab bar. Mobile uses a **bottom tab bar** (5 primary tabs) with a **stack navigator** for game drilldown.

### Bottom Tabs

| Tab | Icon | Maps from |
|---|---|---|
| Games | `football` or `calendar` | `GamesTab` |
| Top Picks | `star` | `TopPicksTab` |
| Board | `grid` | `BoardTab` |
| AI | `sparkles` | `AiPicksTab` |
| Model | `bar-chart` | `ModelTab` |

First Basket is folded into the **Games** tab as a sub-section (or a secondary tab within Game Detail → Props panel). It's low-traffic and saves a bottom tab slot.

### Stack navigator (inside Games tab)

```
GamesScreen → GameDetailScreen (with sub-tabs: Overview | Lineup | Matchup | Props | Boxscore)
```

Use `MaterialTopTabNavigator` for the game-detail sub-tabs (renders as a horizontal tab row inside the screen, which is familiar UX on mobile).

### Date nav

The `DateNav` component renders as a row at the top of Games, Top Picks, and Board screens. It is NOT in the app bar (too cramped on mobile). Instead, render it as the first element in each scrollable screen, sticky with `stickyHeaderIndices` on a `FlatList`, or as a fixed row below the screen header.

---

## 6. API Helpers — Port Guide

All fetch logic lives in `wnba-prop-scout.jsx` as functions named `apiGet*` or `apiPost*`. Extract them verbatim into `src/api.ts`. The only change is the base URL source:

```ts
// src/api.ts
import Constants from 'expo-constants';
const API_BASE: string = Constants.expoConfig?.extra?.apiBase ?? '';

export async function apiGetGames(date: string) {
  const r = await fetch(`${API_BASE}/api/wnba/slate?date=${date}`);
  if (!r.ok) throw new Error(`games ${r.status}`);
  return r.json();
}

export async function apiGetTopPicks(date: string) {
  const r = await fetch(`${API_BASE}/api/wnba/top-picks?date=${date}`);
  if (!r.ok) throw new Error(`top-picks ${r.status}`);
  return r.json();
}

// ... mirror all remaining apiGet* functions
```

The board snapshot POST:

```ts
export async function postBoardSnapshot(slateDate: string, cards: object[]) {
  return fetch(`${API_BASE}/api/wnba/board-snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slateDate, cards }),
  });
}
```

---

## 7. Theme — Port Guide

Copy the `T` object from the web app into `src/theme.ts` as a plain TypeScript export. No changes needed — React Native `StyleSheet` accepts the same hex strings.

```ts
// src/theme.ts
export const T = {
  bg:        '#0c1124',
  card:      '#141d38',
  card2:     '#1b2648',
  card3:     '#212f59',
  border:    '#273660',
  accent:    '#f97316',
  accentDim: 'rgba(249,115,22,0.14)',
  text:      '#f0f4ff',
  text2:     '#8fa3c8',
  text3:     '#4d6080',
  green:     '#22d87a',
  greenDim:  'rgba(34,216,122,0.14)',
  yellow:    '#f4c020',
  yellowDim: 'rgba(244,192,32,0.14)',
  red:       '#f24b4b',
  redDim:    'rgba(242,75,75,0.14)',
  font:      'System',   // RN uses system font by default
} as const;
```

---

## 8. CSS → StyleSheet Translation Rules

These patterns repeat throughout the web JSX and need mechanical substitution:

| Web pattern | React Native equivalent |
|---|---|
| `<div style={{ display:'flex', flexDirection:'row' }}>` | `<View style={styles.row}>` |
| `<div style={{ display:'grid', gridTemplateColumns:'...' }}>` | `<View style={styles.grid}>`  + manual column math |
| `<span>` | `<Text>` |
| `<button onClick={fn}>` | `<TouchableOpacity onPress={fn}>` or `<Pressable>` |
| `<img src={url}>` | `<Image source={{ uri: url }} />` |
| `overflow-x: auto` scroll row | `<ScrollView horizontal showsHorizontalScrollIndicator={false}>` |
| Long list with `map()` | `<FlatList data={items} renderItem={...} keyExtractor={...}>` |
| `position: sticky` | `<FlatList stickyHeaderIndices={[0]}>` |
| `gap: 14px` | `gap: 14` (RN 0.71+ supports gap natively) |
| `border-radius: 12px` | `borderRadius: 12` |
| `backdrop-filter: blur(14px)` | Not supported — use solid background with opacity instead |
| `navigator.clipboard.writeText(text)` | `import * as Clipboard from 'expo-clipboard'; Clipboard.setStringAsync(text)` |
| `window.open(url)` | `import { Linking } from 'react-native'; Linking.openURL(url)` |

### Safe Area

Wrap root content in `<SafeAreaView>` from `react-native-safe-area-context`. The sticky app bar becomes the React Navigation header or a custom header component.

---

## 9. Key Components — Port Notes

### PropCard

The prop pick card is the highest-density UI element. Port it as a standalone `PropCard.tsx`. The EV bar, CLV chip, risk flags, and key factors all live here. Use `View` + `Text` throughout. The gradient background (web uses CSS `background: linear-gradient(...)`) should use `expo-linear-gradient`:

```bash
npx expo install expo-linear-gradient
```

### Score Breakdown (factor bars)

The web renders factor bars with `<div style={{ width: score+'%', background: ... }}>`. In RN use `<View style={{ width: \`${score}%\`, ... }}>` inside a `<View style={{ flex: 1 }}>` container — works identically.

### DateNav

Simple `<View style={{ flexDirection:'row' }}>` with `<Pressable>` left/right arrows and a centered date `<Text>`. Add `expo-haptics` on press for tactile feedback.

### Copy Summary (Board cards)

Web: `navigator.clipboard.writeText(summaryText)` + `document.execCommand`. Mobile: `expo-clipboard`. Show a brief toast via `expo-toast` or a simple timed `useState` flag on the copy button.

### AI Picks Tab

Makes a call to `/api/wnba/ai-picks?date=` which returns a markdown/text narrative. Render with `react-native-markdown-display` instead of raw text:

```bash
npx expo install react-native-markdown-display
```

---

## 10. New Mobile-Native Features

These don't exist in the web app and should be added in the mobile version:

### Push Notifications (`expo-notifications`)

Register for push on first launch. Three trigger points to implement:

| Notification | Trigger | When to send |
|---|---|---|
| "Today's slate is ready" | Daily post-midnight, when `calcConfidence` script completes | ~2 AM ET |
| "Lineup confirmed — [Team]" | When `/api/wnba/lineups` returns starters for a game | ~90 min before tip |
| "Injury alert — [Player]" | When injury data changes for a tracked player | Scheduler check |

The server scheduler (`scripts/scheduler.js`) already runs these jobs. Add a lightweight POST to an Expo Push endpoint after each job completes. Use Expo's push notification service (free, no Firebase setup needed for Expo-managed apps).

### Haptic Feedback

Add `expo-haptics` on: prop card tap-to-expand, copy summary, date navigation tap.

### Offline / Stale Cache

Use `@react-native-async-storage/async-storage` to cache the last successful API response for each screen (keyed by `screen:date`). Show cached data with a "Last updated X min ago" banner when the device is offline.

### Share Sheet

Replace the web "Copy summary" button with a native **Share Sheet** using React Native's built-in `Share.share({ message: summaryText })`. This lets users share picks to iMessage, WhatsApp, Notes, etc. directly.

---

## 11. Server Deployment (prerequisite)

The mobile app needs the Express server publicly accessible (it currently runs locally). Before mobile testing:

1. Deploy `server.js` to **Railway**, **Render**, or **Fly.io** (all have free/hobby tiers, Node.js support, and environment variable management)
2. Set all existing `.env` vars in the platform dashboard (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY, etc.)
3. Ensure the server handles CORS for `*` (already configured with the `cors` package)
4. Set `EXPO_PUBLIC_API_BASE=https://your-deployed-server.com` in the Expo project

The Supabase instance is already cloud-hosted — no action needed there.

---

## 12. Phased Task Plan for Codex

### Phase 1 — Scaffold + API layer (do first)

- `Task M1`: Initialize Expo project, install all dependencies from Section 3, create file structure from Section 4
- `Task M2`: Port `src/theme.ts`, `src/constants.ts`, `src/api.ts` (all `apiGet*` helpers extracted from `wnba-prop-scout.jsx`)
- `Task M3`: Implement `App.tsx` with `TabNavigator` (bottom 5 tabs, placeholder screens)
- `Task M4`: Implement `useDateNav` hook + `DateNav` component

**Acceptance:** `npx expo start` loads without errors; all 5 tabs render with placeholder text; date nav increments/decrements correctly.

---

### Phase 2 — Games screen

- `Task M5`: Implement `GamesScreen` — fetch with `useSlate`, render `GameCard` list, `EmptyState`
- `Task M6`: Implement `GameCard` component — teams, status, spread, O/U, moneyline, form dots
- `Task M7`: Implement `GameDetailScreen` with `MaterialTopTabNavigator` (5 sub-tabs)
- `Task M8`: Implement `OverviewPanel` — head-to-head, odds movement, injury notes
- `Task M9`: Implement `LineupPanel` — starter grid, DNP flags
- `Task M10`: Implement `MatchupPanel` — per-player defender/rating table
- `Task M11`: Implement `PropsPanel` — prop lines per player with DNP risk
- `Task M12`: Implement `BoxscorePanel` — box score table (for final games)

**Acceptance:** Tap a game card → drilldown opens; all 5 sub-tabs load without error; matchups and lineups show real data.

---

### Phase 3 — Top Picks screen

- `Task M13`: Implement `TopPicksScreen` — fetch `useTopPicks`, group by prop type, render `PropCard`
- `Task M14`: Implement `PropCard` — player name, game, line, rec pill, confidence bar, EV/Kelly bar, CLV chip, risk flags, key factors, expand/collapse
- `Task M15`: Implement `EVKellyBar` component — probability color bar + EV chip + Kelly text (port from web Task AE)
- `Task M16`: Implement `ClvChip` + `RiskFlags` components
- `Task M17`: Board snapshot — fire-and-forget POST on date load (port `snapshotFiredRef` pattern using `useRef`)

**Acceptance:** Top picks load for today; cards show EV bar, CLV, risk flags; expand reveals score breakdown; snapshot POST fires once per date.

---

### Phase 4 — Board screen

- `Task M18`: Implement `BoardScreen` — sub-tabs PTS/REB/AST/3PM/Combos, filter bar (tier, lean)
- `Task M19`: Port board-specific card layout (lean, score tier badge, copy summary → Share sheet)
- `Task M20`: Historical date navigation for Board (same `DateNav` component, different data range)

**Acceptance:** Board shows correct picks per prop type; filter by tier works; Share sheet opens with summary text.

---

### Phase 5 — Remaining screens + polish

- `Task M21`: Implement `AiPicksScreen` — fetch `/api/wnba/ai-picks`, render with `react-native-markdown-display`
- `Task M22`: Implement `FirstBasketScreen` — port FirstBasketTab (player rows, starter/bench breakdown)
- `Task M23`: Implement `ModelScreen` — track record stats, hit rate by tier, recent results
- `Task M24`: Add push notification registration + server-side Expo push calls from scheduler
- `Task M25`: Add `AsyncStorage` offline cache to Games, Top Picks, Board screens
- `Task M26`: Add `expo-haptics` to date nav, card expand, copy/share actions

**Acceptance:** All screens functional end-to-end against live server; offline shows cached data with stale banner.

---

### Phase 6 — App Store prep

- `Task M27`: Add app icon + splash screen assets (`assets/icon.png` 1024×1024, `assets/splash.png`)
- `Task M28`: Configure `app.config.js` with bundle IDs (`com.yourname.wnbapropscout`), permissions (notifications), EAS build profile
- `Task M29`: Run `eas build --platform all --profile preview` — verify both builds succeed
- `Task M30`: TestFlight (iOS) + internal test track (Android) — smoke test on device

---

## 13. Key Gotchas

**`IS_SANDBOX` flag** — the web app has `const IS_SANDBOX = false`. Port this to `src/constants.ts` and keep it `false` for production builds. Consider wiring it to `__DEV__` for local testing: `export const IS_SANDBOX = __DEV__`.

**`confidence_score` must be integer** — the snapshot bug from 2026-05-18 applies here too. When building snapshot card payloads in mobile, always `Math.round(pick.confidence_score)` before POSTing.

**Supabase client** — do NOT import `lib/supabase.js` into the mobile app. The mobile app communicates only through the Express API. Supabase keys must never be in the mobile bundle.

**`Date` timezone** — the web app uses `SLATE_RESET_TIME_ZONE = 'America/Los_Angeles'`. React Native's `Date` is UTC-based. Use `Intl.DateTimeFormat` with the LA timezone to compute the slate reset boundary, same as the web does.

**Long lists** — the web uses `array.map()` for all lists. In React Native, any list longer than ~20 items must use `FlatList` (not `ScrollView` + `map`) to avoid blank-screen performance issues.

**`expo-linear-gradient`** — required for the card gradient backgrounds. Without it, use a solid `T.card` background with `opacity`.

**Safe area on notch/island devices** — always wrap screens in `<SafeAreaView edges={['top', 'bottom']}>` or use `useSafeAreaInsets()` for fine-grained control.

---

## 14. What to copy from the web repo into mobile repo

Copy these files verbatim (or near-verbatim) as source material for porting:

| Source (web repo) | Destination (mobile repo) | Action |
|---|---|---|
| Theme object `T` in `wnba-prop-scout.jsx` | `src/theme.ts` | Direct copy, change `font` value |
| All `apiGet*` / `apiPost*` functions | `src/api.ts` | Direct copy, change `API_BASE` source |
| `TEAM_VENUES`, `SEASON`, constants | `src/constants.ts` | Direct copy |
| `SANDBOX` data object | `src/sandbox.ts` | Direct copy (for dev testing) |
| Sandbox mock functions | `src/sandbox.ts` | Direct copy |
| Score factor labels/ordering logic | `src/components/ScoreBreakdown.tsx` | Port with `View`/`Text` |

Do NOT copy CSS template strings, `document.*`, `navigator.*`, `window.*`, or `import.meta.env.*` — all of these need mobile equivalents as described in Section 8.

---

*End of mobile handoff document.*
