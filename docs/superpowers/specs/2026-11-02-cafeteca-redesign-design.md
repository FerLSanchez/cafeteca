# Cafeteca redesign

Agreed mockup: https://claude.ai/artifact/YFfKxiEGqsms4Vr6TnFWdr (private, owner only).
Base system: the Bodega design system, https://claude.ai/artifact/XdiZ3THhrzC7cw7aRd64zE. Read its `project/README.md`, `project/tokens.json` and `project/components/*/README.md` before starting.

## Intent

Cafeteca still has the brown-and-serif look that Bodega and Volted have just left behind. Fernando wants it to give very nearly the same experience as Bodega, because coffee and wine are both tasting passions. The difference is that Cafeteca has more live interaction: pouring a shot with the Bluetooth scale. That moment gets the most design attention.

The app is used mainly on a phone, and must also work well on tablet and desktop.

### The moment to design for

The phone sits on the counter and stays awake. Fernando checks or accepts the suggested details in the brew modal, taps the scale shot button, connects through Chrome's Bluetooth chooser, starts pouring, and watches until 3·2·1·STOP tells him to stop. He is at arm's length with both hands busy, so what he needs must be readable from the counter without touching the phone.

## Goals

- Apply Bodega's system: tokens, type, spacing, radii, rows over cards, navigation by width, Lucide icons, no emoji, sentence case, colour only where it means something.
- Give Cafeteca its own accent, neutrals and icon, so it is a sibling of Bodega and not a copy.
- Rebuild the live shot as a full-screen instrument readable from the counter.
- Reflow properly at phone, tablet and desktop widths.

## Non-goals

- **No change in functionality**, with one exception Fernando asked for: the count of scale shots waiting to be rated. Otherwise the actions, data, flows, API, schema and calculations stay the same. The only other backend change is the font delivery item under Fonts.
- No other new features. A theme selector in Ajustes (device, light, dark) was added at Fernando's request after the first trial deploy.
- No changes to the scale protocol, shot detection, `StopCountdown` timing, the grind model or the taste logic.

## Anti-goals

These would make the redesign a failure even if it looks good:

- An action that exists today becomes missing or harder to reach.
- Anything interrupts or destabilises a shot: lost samples, a late countdown, a stage that closes itself, or a lost wake lock.
- A modal reload, or a layout change, that discards a brew in progress.
- It reads as generic: cards everywhere, cream and serif, or decorative colour.

## Decisions Fernando made

| Topic | Decision |
|---|---|
| Direction | Very close to Bodega |
| Accent | Tueste (roast copper) |
| Icon | Taza desde arriba (cup seen from above) |
| Phone screens | Cafés and Preparar as in the mockup |
| Live shot | Full screen, dark in both themes, weight at about 100 px on phone |
| Countdown | Same fixed 1 s beat; 3, 2, 1 step up through the accent; STOP is the only red |
| Saving after a shot | One tap from the finished shot screen, as today's flow is one tap |
| Pending ratings | Prepas shows a count of shots waiting to be rated, for scale shots only |
| Tablet and desktop | Icon rail with two columns; sidebar with one-line bags; wide shot with numbers on the left and curve on the right |

## Tokens

Everything not listed here takes Bodega's value unchanged: spacing, radii, shadows, control sizes, breakpoints, z-index, type scale and motion.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `bg` | `#f6f5f2` | `#121211` | Cup porcelain, in place of Bodega's chalk |
| `surface` | `#ffffff` | `#1b1a19` | |
| `surface-sunken` | `#edece8` | `#0d0d0c` | |
| `surface-raised` | `#ffffff` | `#242321` | Overlays only |
| `line` | `#e2e1db` | `#2e2d2b` | |
| `line-strong` | `#8d8c84` | `#6f6d68` | Control borders; 3.1:1 or better |
| `ink` | `#1b1a18` | `#eeede9` | |
| `ink-2` | `#4a4843` | `#c2c0ba` | |
| `ink-muted` | `#66645d` | `#9a9892` | 5:1 or better on every surface |
| `accent` | `#a64b14` | `#ee9a63` | Tueste; 4.8:1 or better, including on `accent-soft` |
| `on-accent` | `#ffffff` | `#2a1205` | |
| `accent-soft` | `#f7e8dd` | `#38220f` | |
| `focus`, `success`, `warning`, `danger`, `info` and their `-soft` | Bodega's values | Bodega's values | |

Flow state during a shot: below the band `info`, in the band `success`, above the band `warning`. Each is always paired with a word.

Accent and `danger` have nearly equal lightness in the light theme, so destructive actions must always carry a word or the trash icon, never colour alone.

Fonts: Bricolage Grotesque (titles and wordmark), Geist (UI), Geist Mono (grams, seconds, g/s, ratios, prices, dates in columns). These replace Playfair Display and Figtree.

Theme: follow `prefers-color-scheme` by default, as Bodega does. Ajustes offers device, light or dark, stored per device in `localStorage('theme')`. Canvases must redraw when the theme changes.

## Icon

`static/icon.svg`: full-bleed 512×512, Tueste field, with everything inside the maskable safe circle (r=205). The exact shape is symbol `i-b` in the mockup: porcelain cup and handle, ink coffee, crema arc in `#ee9a63`.

- Replace `icon-192.png` and `icon-512.png`. Add a 180 px `apple-touch-icon`.
- Favicon at 16 px: drop the crema arc.
- In-app mark: the same cup without the field, with light and dark versions, next to the lowercase word **cafeteca** in Bricolage 700.
- Manifest: `theme_color` and `background_color` become `bg`. The HTML gets two `theme-color` metas, one per scheme.

## Fonts

Self-hosted woff2 in `static/fonts/` (the app is an offline PWA). This requires two delivery changes:

- `app.py` CSP: `font-src 'self'`, and remove the Google Fonts hosts from `style-src` and `font-src`.
- `static/sw.js`: add the font files to `SHELL`.

## Navigation

| Width | Layout |
|---|---|
| Under 640 px | Bottom tab bar: Cafés, Prepas, centre add button, Stats, Catálogos. The page header holds the scale chip, search and Ajustes |
| 640–1023 px | Icon rail with the add button on top, destinations, then scale chip and Ajustes at the bottom |
| 1024 px and up | 232 px sidebar: mark and wordmark, *Añadir café*, search, destinations, then scale chip and Ajustes at the bottom |

Touch target size follows `pointer: coarse`, not width. The search stays live-filtering as today. On phone it opens from an icon into a field; a search already typed must stay visible.

## Screens

Mockup copy is illustrative. **Keep the app's existing wording and i18n keys**, removing only emoji and glyph prefixes. For example, the button stays "Sacar shot con báscula", not the mockup's "Verter con báscula".

Every page: a `display` title, one summary line, then actions on the right.

### Cafés

- Summary line from data already loaded: *2 abiertos, 689 g en uso, 3 sin abrir*.
- Status pills become chips. Sort select, compact toggle and advanced filters stay.
- Coffee as a row: `Tostador · Café`, then origin, process and age, then grams and shots in mono with the remaining bar.
- All of today's information must stay reachable, including price per kg, cost per cup, milk types, low-stock warning, rating and quantity. Secondary items can wrap onto the meta line.
- Open bags: Preparar (`accent-soft`), Consumir 17 g (secondary), Terminado hoy (icon with `aria-label`). Unopened bags: Abrir hoy and its confirmation.
- Compact view stays as a one-line row.

### Preparar

Bottom sheet under 640 px, centred modal above. The four steps, step ticks, steppers, suggestion lines and *Usar* buttons, scale dose panel and rating stay. The scale shot button is the primary action until a shot exists. Save is secondary before that point and primary afterwards. `data-keep-open` stays.

### Live shot

`createShotView()` keeps its logic and callbacks, and only its markup and styling change. It is used both by the brew modal and by the scale test page.

- Covers the whole viewport from the moment the shot view opens, in dark tokens regardless of theme.
- Weight is the largest element: about 104 px at 390 px wide, about 150 px on wide screens. It uses tabular figures and must not reflow as digits change.
- Then target and ratio, a thicker progress bar, time and flow at about 44 px, and the flow state word.
- Curve with target band and ghost curve when there is one, using `drawCanvasFitted()`.
- Everything present today stays: status text including the waiting instruction, stop cue line, sound toggle, ghost legend, cancel, and after the shot the summary, metrics, comparison and retry.

When a shot ends, the results apply to the brew automatically, as they do today. The stage stays open showing the summary, so the numbers can still be read from the counter. Nothing closes it on a timer. Its actions are:

- **Primary, save:** the brew modal's existing save, with its existing behaviour and toast. With no stars yet it reads "Guardar · valorar después". This keeps pour-then-save at one tap.
- **Secondary, back to the brew modal:** to rate now or change a value. The modal shows the existing shot summary.
- **Repetir shot**, as today.

On the scale test page there is no brew to save, so the stage shows only its existing actions.

The canvas functions read colours from `document.documentElement`. The stage's dark tokens are scoped, so these must read from the canvas's own element or the curve will use the wrong theme.

The stage sits inside the modal so that focus handling and Esc keep working. Modal entrance transforms must not break its `position: fixed`.

### Countdown

`stopCountdownRun()` logic and timing are untouched. Only colours change: 3, 2 and 1 step up through the accent, STOP is `#c62828` with white text (5.6:1). Numbers keep the current size rule. Dots and the gram line stay, and the reduced-motion rule stays.

### Remaining screens

The mockup doesn't show these. Build them from the system and show them to Fernando before shipping:

- **Prepas:** the summary line includes the pending count below. Each brew as a row with date, coffee, numbers in mono, sparkline, quick rating. *Nueva preparación* as a primary button in the page header.
- **Ficha:** bottom sheet on phone. Definition rows instead of a boxed grid. Keep recipe, dial-in, grind section, brews, family bags, editing remaining grams.
- **Stats:** StatTile strip for the hero figures, Gantt, grind drift, bars using `chart-1` with values at the ends. No decorative gradients or glows.
- **Catálogos:** page header, one bordered list with inline actions.
- **Coffee form, recipe, pick coffee, confirm, settings, scale test:** Modal and FormSection rules, max 720 px.
- **Toasts, empty states, focus ring:** Bodega's components. Focus is the 2 px `focus` blue.

## Scale shots waiting to be rated

A count that says a shot is still waiting, so it isn't forgotten.

- **What counts:** a brew with `shot_metrics` from the scale that still shows "¿Qué tal estaba?" today, meaning it lacks stars or balance and is within `QUICK_RATE_DAYS` (2). Quick "Consumir" logs and manual brews never count. After the window the prompt disappears and the count drops with it, so the count never points at something you can't act on.
- **Where:** a count on Prepas in the tab bar, rail and sidebar, as Bodega does for bottles to rate. It is hidden at zero. The Prepas summary line says the same in words, for example *1 shot por valorar*.
- **Data:** new `GET /api/brews/pending?since=YYYY-MM-DD` returning `{count}`, with `since` sent by the client from `todayLocal()` because of the server's UTC offset. The brews list is paginated, so it can't be counted on the client. No schema change.
- **Refresh:** on startup and after saving, rating or deleting a brew. A failed request hides the count and never shows an error.
- **Tests:** pytest covers what counts and what doesn't, including the date window. E2E covers the count appearing after a scale shot and clearing once rated.

## Number and text formats

Grams, seconds, g/s, ratios and prices display in the current language's format: `30,4 g` and `1:2,11` in Spanish, `30.4 g` in English, with a space before units. This is display only. Stored values, input fields, API payloads and pure-module calculations don't change.

Icons replace emoji in both `es.json` and `en.json`, keeping the same key set. ★ stays as the rating glyph.

## Constraints

- Must not break: the i18n key tests, or the JS hooks and IDs that `tests/e2e/*` rely on. Keep IDs and JS-facing classes, or update those tests in the same change with the reason stated.
- Must still hold: `docker-compose.yml` publishes only `127.0.0.1:5323`.
- `index.html` plus plain JS and CSS, no build step and no framework.
- Prod has real data. Never test writes against `127.0.0.1:5323`. Use a local instance with a test database or a throwaway copy.

## How we'll know it works

- `pytest` and `node --test tests/js/*.test.js` pass.
- The e2e suites pass against a local instance: `touch-targets`, `layout-widths` (no sideways scroll at 390, 768, 820, 1024, 1280), `modals`, `brew-flow`, `scale-flow`, `wake-lock`, `grind-prediction`, `list-prefs`. Add 640 and 1440 to `layout-widths`.
- An action inventory taken from today's UI, checked against the new UI screen by screen. Nothing missing.
- Screenshots of every screen at 390, 820 and 1280 in both themes.
- One real shot with the scale on the Pixel before calling it finished. Only Fernando can do this.

## Left to the builder

CSS file organisation, migration order, class names beyond those tests rely on, and how to split the work into reviewable steps.

## Calls I made (Claude), for Fernando to check

1. Bodega's design tokens are copied, not shared. The apps deploy separately and a shared package adds machinery for no gain.
2. "Abiertos" and "Sin abrir" group headers appear only with the *Recomendado* sort. With any other sort they would break the order you asked for, so that list stays flat.
3. The flow state word (*En banda*, *Lento*, *Rápido*) is new text, in both languages, so state isn't colour alone. Along with the summary line, the pending count and the button back to the brew modal, it is the only new copy.
4. Numbers change to the language's decimal format, as above.
5. Geist Mono's slashed zero and wide comma stay, as in Bodega.
6. After the UI ships, publish a **Cafeteca** design system artifact from the final tokens, like Bodega's. Tell me if you don't want it.
7. A shot stays pending until it has stars and balance, matching when "¿Qué tal estaba?" goes away, not just until it has stars.
8. Work happens on a branch with a PR. A push to `main` builds the production image, so nothing merges until you've reviewed it.
