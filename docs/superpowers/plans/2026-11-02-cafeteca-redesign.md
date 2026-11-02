# Cafeteca Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Cafeteca's UI on Bodega's design system with its own accent and icon, a full-screen live shot, and a count of scale shots waiting to be rated, without changing anything else the app does.

**Architecture:** No build step. `static/css/style.css` is rewritten section by section on new tokens, while the old token names stay as aliases until the last screen moves, so the app works after every task. Markup changes stay in `templates/index.html` and the JS template strings, and every ID and handler keeps its name. The only backend additions are one read-only endpoint and the CSP change.

**Tech Stack:** Flask, SQLite, vanilla JS and CSS, self-hosted woff2 fonts, pytest, `node --test`, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-11-02-cafeteca-redesign-design.md`. Read it first: tokens, screen rules and copy rules live there and aren't repeated here. Agreed mockup: https://claude.ai/artifact/YFfKxiEGqsms4Vr6TnFWdr. Base system: Bodega, https://claude.ai/artifact/XdiZ3THhrzC7cw7aRd64zE (`project/README.md`, `project/tokens.json`, `project/components/bundle.css`, `project/components/*/README.md`).

## Global Constraints

- **Never run e2e or any write against `127.0.0.1:5323`. That is production on this server.** Use the local server from Task 1 on port `5399`.
- Prod data is read-only for checks: GET requests only, with non-GET requests blocked in any browser script.
- Work on branch `claude/redesign`. Never push to `main`, because that builds the production image. Open a PR only when Fernando asks.
- End commit messages with the attribution lines from the session's system reminder.
- No new functionality beyond the spec's list. Keep existing wording and i18n keys, removing only emoji and glyph prefixes.
- Keep every element ID, every `on*` handler name and every `data-*` hook. Keep classes used by `tests/e2e/*`: `.stop-cd`, `.stop-cd[data-n]`, `.fb`, `.btn-shot`, `.btn-scale`, `.brew-star`, `.taste-scale`, `.shot-summary`, `.shot-legend`, `.toast-action`, `.stats-grind-row`, `.detail-family-bag`.
- New i18n keys go in both `es.json` and `en.json`.
- Touch targets at least 44 px under `pointer: coarse`. Text at least 4.5:1. Focus is 2 px solid `--focus`, 2 px offset.
- Don't touch logic in `scale.js`, `scale-analysis.js`, `grind-model.js`, or `StopCountdown` timing.
- `docker-compose.yml` keeps `127.0.0.1:5323`.

## Review Focus

1. **Phone switches between light and dark during a shot** (automatic at dusk): the stage stays dark and the curve doesn't change colour or lose points. Test in Task 8.
2. **Double tap or failed save on the finished shot screen:** one tap must create exactly one brew. A failed save must leave the stage open with the shot intact. Test in Task 8.
3. **Shot with no usable result** (`tracker.result` is null): no save button appears, only retry and back. Test in Task 8.
4. **Phone in landscape on the counter** (844×390): weight, flow and cancel all stay visible with no clipped digits. Test in Task 8.
5. **Long values:** a 40-character coffee name, `1000 g` left, or a weight of `123,4 g` must not overflow at 390 px. Test in Tasks 6 and 8.

---

### Task 1: Safe local server, action inventory, branch

**Files:**
- Create: `tests/e2e/serve.py`, `tests/js/actions.test.js`, `tests/js/fixtures/actions-baseline.json`
- Modify: `tests/e2e/*.e2e.js` (default `BASE`), `CLAUDE.md` (test commands)

**Interfaces:**
- Produces: a local app at `http://localhost:5399`, started with `python tests/e2e/serve.py [db-path]`. The action baseline every later task must keep green.

- [ ] **Step 1: Create the branch and commit the spec and plan**

```bash
git switch -c claude/redesign
git add docs/superpowers && git commit -m "docs: redesign spec and plan"
```

- [ ] **Step 2: Write `tests/e2e/serve.py`**

Set `db.DB` to the argument, or a new temp file when there is none, **before** `import app`, then run on port 5399. It refuses to start if the path resolves to `/data/coffee.db` or `<repo>/data/coffee.db`.

- [ ] **Step 3: Change the default `BASE` in every e2e file to `http://localhost:5399`**

Today they default to 5323, which writes into production when run from this server.

Run: `grep -c 5323 tests/e2e/*.js`
Expected: `0` for every file.

- [ ] **Step 4: Write the failing test `tests/js/actions.test.js`**

```js
test('no UI action disappears', () => {
  const now = handlerNames();          // every name called from on*="…" in index.html and static/js/*.js
  const lost = baseline.filter(n => !now.includes(n));
  assert.deepEqual(lost, []);
});
```

- [ ] **Step 5: Run it and verify it fails**

Run: `node --test tests/js/actions.test.js`
Expected: FAIL, baseline file missing.

- [ ] **Step 6: Generate `actions-baseline.json` from `main`'s source and sort it**

- [ ] **Step 7: Run all tests**

Run: `pytest -q && node --test tests/js/*.test.js`
Expected: all pass.

- [ ] **Step 8: Run the existing e2e suites against the local server to record the baseline**

Run, with the server up: `NODE_PATH=~/.npm/_npx/e41f203b7505f1fb/node_modules BASE_URL=http://localhost:5399 node tests/e2e/<each>.e2e.js`
Expected: all pass. Record any failure in the commit message as already failing.

- [ ] **Step 9: Update the test commands in `CLAUDE.md` and commit**

### Task 2: Tokens, fonts, theme

**Files:**
- Create: `static/fonts/` (woff2 and `OFL` license notes)
- Modify: `static/css/style.css:1-55`, `templates/index.html:7-16`, `app.py:36-48`, `static/sw.js:2-30`, `static/js/utils.js`, `static/js/scale-ui.js`, `static/js/grind-ui.js`
- Test: `tests/test_settings.py` or a new `tests/test_app.py`

**Interfaces:**
- Produces: CSS custom properties named as in the spec's token table and Bodega's `tokens.json` (`--bg`, `--surface`, `--surface-sunken`, `--surface-raised`, `--line`, `--line-strong`, `--ink`, `--ink-2`, `--ink-muted`, `--accent`, `--accent-hover`, `--on-accent`, `--accent-soft`, `--focus`, `--success`, `--warning`, `--danger`, `--info` and `-soft` forms, `--radius-*`, `--space-*`, `--shadow-*`, `--font-display`, `--font-sans`, `--font-mono`).
- Produces: `.theme-dark` class that applies the dark token values to any subtree.
- Produces: `canvasColors(canvas) -> (name) => string` in `utils.js`, reading computed values from the canvas element.

- [ ] **Step 1: Write the failing test**

```python
def test_csp_serves_fonts_from_self_only(client):
    csp = client.get('/').headers['Content-Security-Policy']
    assert "font-src 'self'" in csp
    assert 'googleapis' not in csp and 'gstatic' not in csp
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pytest tests/test_app.py -q`
Expected: FAIL on `font-src`.

- [ ] **Step 3: Add the fonts and update the CSP and head**

Use `npm pack` in a new empty directory for `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` and `@fontsource-variable/bricolage-grotesque`. Copy only the `*-latin-wght-normal.woff2` files and licenses. Declare `@font-face` with `font-display: swap` and real fallback stacks. Add the fonts to `SHELL` in `sw.js`, and preload Geist.

Remove the Google Fonts links from `index.html`. Update `font-src` and `style-src` in `app.py`.

- [ ] **Step 4: Add tokens for light, dark and theme switching**

Light on `:root`, dark under `@media (prefers-color-scheme: dark)`, and the same dark values on `.theme-dark` (which also sets `color-scheme: dark` and `color: var(--ink)`).

Then map old names to new so nothing breaks: `--text: var(--ink)`, `--text2: var(--ink-2)`, `--text3: var(--ink-muted)`, `--border: var(--line)`, `--border2: var(--line-strong)`, `--surface2: var(--surface-sunken)`, `--surface3: var(--surface-sunken)`, `--accent2: var(--accent)`, `--accent-dim: var(--accent-soft)`, `--green: var(--success)`, `--red: var(--danger)`, `--amber: var(--warning)`, and so on for every old token. Set `theme-color` metas per scheme.

- [ ] **Step 5: Point canvas drawing at `canvasColors(canvas)`**

Replace `getComputedStyle(document.documentElement)` in `scale-ui.js:303`, `scale-ui.js:681` and `grind-ui.js:137`. Add a `matchMedia('(prefers-color-scheme: dark)')` listener that redraws visible canvases by calling the existing draw functions.

- [ ] **Step 6: Run the tests**

Run: `pytest -q && node --test tests/js/*.test.js`
Expected: all pass.

- [ ] **Step 7: Check fonts load offline and with the CSP**

Load the local server with Playwright, block all non-local requests, and assert `document.fonts.check('16px Geist')` is true with no CSP console errors.

- [ ] **Step 8: Commit**

### Task 3: App icon

**Files:**
- Modify: `static/icon.svg`, `static/icon-192.png`, `static/icon-512.png`, `static/manifest.json`, `templates/index.html:12-13`, `static/sw.js`
- Create: `static/apple-touch-icon.png`, `static/favicon.svg`, `static/mark.svg`, `static/mark-dark.svg`

- [ ] **Step 1: Write `icon.svg` from symbol `i-b` in the mockup**

Full-bleed, no rounded corners: field `#a64b14`, handle rect `x=340 y=230 w=98 h=52 rx=26` and disc `cx=238 cy=256 r=130` in `#f6f5f2`, inner disc `r=94` in `#1b1a18`, crema arc `M178 256a60 60 0 0 1 60-60` stroke `#ee9a63` width 13 round.

`favicon.svg` is the same without the arc. `mark.svg` and `mark-dark.svg` drop the field: light uses ink `#1b1a18` for cup and accent `#a64b14` for coffee; dark uses `#eeede9` and `#ee9a63`.

- [ ] **Step 2: Render the PNGs at 192, 512 and 180 with Playwright from the SVG**

- [ ] **Step 3: Update the manifest**

`theme_color` and `background_color` become `#f6f5f2`. Keep `purpose: "any maskable"`. Remove the old SVG entry only if the file no longer exists. Add new files to `SHELL`.

- [ ] **Step 4: Look at the icons at 512, 48 and 16 px, and through a circular mask of r=205 to confirm nothing is cut**

- [ ] **Step 5: Commit**

### Task 4: Icons replace emoji; language-aware numbers

**Files:**
- Modify: `templates/index.html` (sprite at top, emoji), `static/i18n/es.json`, `static/i18n/en.json`, `static/js/{api,brews,catalog,detail,form,grind-ui,list,scale,scale-ui,stats,taste-ui}.js`, `static/js/utils.js`, `static/js/i18n.js`
- Test: `tests/js/i18n.test.js`, new `tests/js/format.test.js`

**Interfaces:**
- Produces: `fmtNum(value: number, decimals: number, lang = _currentLang) -> string` in `i18n.js`, exported with `if (typeof module !== 'undefined') module.exports = {fmtNum}` so node can test it. `fmtG` (`scale-ui.js:75`, still `'—'` for null), `fmtRatio`, `fmtFlow`, `fmtPrice` and `fmtWeight` output through it, with a space before units.
- Produces: `icon(name, extraClass)` covering the set Lucide names used below, with sprite IDs kept where they exist.

- [ ] **Step 1: Write the failing tests**

```js
test('no emoji in UI strings', () => {
  for (const [lang, d] of Object.entries(dict))
    for (const [k, v] of Object.entries(d))
      assert.ok(!/\p{Extended_Pictographic}/u.test(v.replaceAll('★', '').replaceAll('☆', '')), `${lang} ${k}`);
});
test('fmtNum follows the language', () => {
  assert.equal(fmtNum(30.4, 1, 'es'), '30,4');
  assert.equal(fmtNum(30.4, 1, 'en'), '30.4');
  assert.equal(fmtNum(30, 1, 'es'), '30,0');
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `node --test tests/js/*.test.js`
Expected: FAIL listing emoji keys, and `fmtNum` undefined.

- [ ] **Step 3: Replace emoji in strings, JS templates and HTML**

Mapping: 🫖 and ☕ none or `coffee`; 📋 `clipboard-list`; ⚙️ `sliders-horizontal`; ✏️ `pencil`; 📅 `calendar`; 📦 `package-open`; ✅ and ✓ `check`; 🗑 `trash-2`; 🧹 `trash-2`; ⚠️ `triangle-alert`; 🎯 `target`; ⚖️ `bluetooth`; 🔋 `battery-low`; 🌊 `waves`; 🔥 `flame`; 🔊 and 🔇 `volume-2` and `volume-x`; ✕ `x`; ⏱ `timer`; ↺ `rotate-ccw`; ↕ removed.

For toasts and confirm dialogs, drop the prefix or pass an icon name to `showConfirm({icon})` and `showToast`. `showConfirm`'s `icon` argument changes from emoji to icon name; update all callers.

The ★ glyph stays. `scale.shot.ghost`'s `- - -` stays because it describes a dashed line.

- [ ] **Step 4: Add `fmtNum` and route display numbers through it**

Grams, seconds, g/s, ratios, prices, °C and the shot view's live numbers. Keep `toFixed` for anything sent to the API or written into an `<input>`. Check `b-yield` and `b-time` in `brewScaleShot()`'s `onDone`: `r.yield_g` must stay a raw number there.

- [ ] **Step 5: Run the tests**

Run: `pytest -q && node --test tests/js/*.test.js`
Expected: all pass, including action inventory and i18n parity.

- [ ] **Step 6: Commit**

### Task 5: Navigation

**Files:**
- Modify: `templates/index.html:169-204,323-340`, `static/css/style.css` (Navegación sections), `static/js/list.js:213-221`, `static/js/filters.js`
- Test: `tests/e2e/layout-widths.e2e.js`, `tests/e2e/touch-targets.e2e.js`, `tests/e2e/list-prefs.e2e.js`

**Interfaces:**
- Produces: `<nav class="app-nav">` with `.app-nav-item[data-page]` (keeping the `bnav-item` class and `showPage(name, this)`), `.app-nav-brand`, `.app-nav-add` (calling `openAddModal()`), `.app-nav-foot` containing `#scale-chip` and the Ajustes button. One element restyled across widths, replacing the separate top and bottom navs.
- Produces: a `<span class="nav-count" id="nav-count-brews" hidden>` inside the Prepas item, used by Task 9.
- Produces: `.page-header` with `.page-title`, `.page-summary` and `.page-actions`, used by all later screen tasks.
- Produces: `#search-input` stays the single search field. `toggleSearch()` opens it on phone.

- [ ] **Step 1: Update `layout-widths.e2e.js`**

Change `WIDTHS` to `[390, 640, 768, 820, 1024, 1280, 1440]`, and assert at 390 that `.app-nav` is at the bottom, at 820 that it is under 80 px wide, at 1280 that it is 232 px wide.

- [ ] **Step 2: Run it and verify it fails**

Expected: FAIL, `.app-nav` not found.

- [ ] **Step 3: Build the nav as in the mockup**

Under 640 px the tab bar has Cafés, Prepas, centre add button, Stats, Catálogos, with `padding-bottom: env(safe-area-inset-bottom)`. The body layout uses a grid with a nav column at 640 px and up. Remove `.nav-tabs`, `.bottom-nav` and `.nav-logo-tag`. Keep the `nav.tagline` key in the JSON only if still used; otherwise remove it from both languages.

- [ ] **Step 4: Add `toggleSearch()`**

Under 640 px, an icon in the page header reveals the field and focuses it. If `#search-input` has text, the field stays visible.

- [ ] **Step 5: Run the e2e suites**

Run: `layout-widths`, `touch-targets`, `list-prefs`, `modals`.
Expected: PASS.

- [ ] **Step 6: Commit**

### Task 6: Cafés list

**Files:**
- Modify: `static/js/list.js:81-160`, `static/js/filters.js`, `templates/index.html:206-292`, `static/css/style.css` (Barra de filtros to Cargar más)
- Create test: `tests/e2e/list-rows.e2e.js`

**Interfaces:**
- Consumes: `.page-header` from Task 5.
- Produces: `renderCoffeeRow(c)` and `renderCompactCard(c)` in `list.js`; `listSummaryHtml(coffees) -> string`.

- [ ] **Step 1: Write the failing e2e test `list-rows.e2e.js`**

Seed one open bag with a 40-character name and `1000` g remaining, one unopened bag. Assertions at 390, 820 and 1280:

```js
assert.equal(await page.locator('.coffee-row').count(), 2);
assert.ok(await noHorizontalOverflow(page));
assert.match(await page.locator('.page-summary').innerText(), /1.*abierto/);
for (const text of ['€/kg', 'taza']) assert.ok(await rowHasText(page, text));  // price and cost per cup survive
await assertGroupHeaders(page, 'smart', ['Abiertos', 'Sin abrir']);
await assertGroupHeaders(page, 'name_asc', []);
```

- [ ] **Step 2: Run it and verify it fails**

- [ ] **Step 3: Implement the rows**

Per the spec's Cafés section. Summary line counts come from the full coffee array already in memory. Group headers appear only with `smart` sort, and only when both groups have members. Under 1024 px, actions sit below the text. From 1024 px, use a three-column grid: `minmax(0,1.4fr) 180px auto`. The list uses `container-type: inline-size`.

Keep the `consumeShot`, `undoConsume`, `openBrewModal`, open-today and finish-today handlers, the `.consume-block` behaviour and the "Cargar más" flow.

Compact view stays as a one-line row. Filter pills become chips but keep class `.fb`.

- [ ] **Step 4: Run the e2e suites**

Run: `list-rows`, `list-prefs`, `brew-flow`, `touch-targets`.
Expected: PASS.

- [ ] **Step 5: Commit**

### Task 7: Modal system and Preparar

**Files:**
- Modify: `static/css/style.css` (Modal, Formulario, Botones, Valoración, Modal de preparación), `templates/index.html:575-680`, `static/js/brews.js:309-440`
- Test: `tests/e2e/modals.e2e.js`, `tests/e2e/brew-flow.e2e.js`

**Interfaces:**
- Produces: `.modal` as a bottom sheet under 640 px and a centred 560 px dialog above, both without `transform` when open, so `position: fixed` children work. Button classes `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`.
- Produces: `#b-submit` is `.btn-secondary` while `.btn-shot` is visible and no shot exists, and `.btn-primary` otherwise. The state is set in `updateBrewSteps()`.

- [ ] **Step 1: Add the failing assertions to `brew-flow.e2e.js`**

```js
const r = await page.locator('#modal-brew .modal').boundingBox();
assert.equal(Math.round(r.y + r.height), 844);   // sheet reaches the bottom at 390×844
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#modal-brew .modal')).transform), 'none');
```

- [ ] **Step 2: Run it and verify it fails**

- [ ] **Step 3: Restyle modals, forms, steppers, buttons, chips and stars with tokens**

Entrance animation animates `opacity` and `translate` only until finished, and has `animation-fill-mode: none`. Respect reduced motion. `.btn-shot` is the primary look when visible.

- [ ] **Step 4: Run the e2e suites**

Run: `modals`, `brew-flow`, `scale-flow`, `touch-targets`.
Expected: PASS.

- [ ] **Step 5: Commit**

### Task 8: Live shot stage and countdown

**Files:**
- Modify: `static/js/scale-ui.js:150-262,373-400,484-510`, `static/js/brews.js:444-470`, `static/css/style.css:1685-1801`, `static/i18n/*.json`
- Create test: `tests/e2e/shot-stage.e2e.js` (use the fake scale bus already in `tests/e2e/scale-flow.e2e.js`)

**Interfaces:**
- Consumes: `canvasColors`, `.theme-dark`, `fmtNum`.
- Produces: `createShotView(root, opts)` keeps its signature, with new optional `opts.onSave()` and `opts.saveLabel()`, and `opts.onBack()`. When `onSave` is set and a result exists, the finished stage shows the save button.
- Produces: `.shot-stage` on `root` while open; `document.body.classList` gains `shot-open`.
- Produces: `submitBrew()` guards against re-entry and leaves the modal open on failure.
- New keys: `scale.shot.back`, `scale.flow.in_band` ("En banda" / "In band"), `scale.flow.slow` ("Lento" / "Slow"), `scale.flow.fast` ("Rápido" / "Fast").

- [ ] **Step 1: Write the failing `shot-stage.e2e.js`**

```js
test('stage covers viewport and is dark in light theme')        // box == viewport; bg == #121211 under colorScheme:'light'
test('weight is the largest text, about 104 px at 390')         // computed font-size between 96 and 112
test('flow state has a word')                                   // feed flow in/below/above band → En banda / Lento / Rápido
test('curve survives a theme switch mid-shot')                  // emulateMedia dark; stage bg same; canvas still has non-blank pixels
test('save is one tap and creates one brew')                    // finish shot; dblclick .shot-save; GET brews total +1; modal closed; toast shown
test('failed save keeps the shot')                              // route POST abort; click save; stage still open; #b-yield keeps its value
test('no result shows no save')                                 // finish with result null; .shot-save absent; retry and back present
test('back returns to modal with summary')                      // click back; #b-shot-summary visible; #b-submit primary
test('landscape keeps it all visible')                          // 844×390: weight, flow and cancel inside viewport
test('123,4 g fits at 360 px')                                  // feed weight 123.4; no overflow
test('countdown colours')                                       // .stop-cd[data-n=0] bg rgb(198,40,40); data-n=1 bg == accent
```

- [ ] **Step 2: Run it and verify it fails**

- [ ] **Step 3: Rebuild the markup in `createShotView()`**

Keep every `q()` selector's target: `.shot-status`, `[data-k=time|weight|flow|ratio|target]`, `.shot-progress-bar`, `.shot-cue`, `.shot-chart`, `.shot-summary`, `.shot-actions`. Add the flow word `[data-k=flow-state]`, updated in `renderLive()` beside the existing `in-band` and `over` class toggles. Below band is a new `under` class.

Stage layout: phone in a single column per the mockup; at `min-width: 640px` or in landscape, two columns (`.shot-stage` is a grid). Weight uses `font-size: clamp()` bounded so five characters fit, and `font-variant-numeric: tabular-nums`. In landscape phones the weight scales down by height.

- [ ] **Step 4: Add `.shot-stage`**

`position: fixed; inset: 0; z-index` above the modal, below `.stop-cd`, class `theme-dark`, `overflow-y: auto`, safe-area padding. Lock background scroll with `shot-open`. The stage stays inside `.modal` in the DOM so `_modalStack`, Esc and Tab keep working.

- [ ] **Step 5: Wire the finished actions**

`brewScaleShot()` passes `onSave: submitBrew`, `saveLabel` reading `#b-submit`'s current text, and `onBack: brewShotClose`. `setAction` becomes able to render several buttons. The scale test page passes none of these.

`submitBrew()` gets a `_brewSaving` flag cleared in `finally`. `api()` already shows the error toast; the modal closes only after a successful response.

- [ ] **Step 6: Recolour the countdown**

`.stop-cd[data-n="3"]` is accent 55% mixed with `#121211` with white text, `data-n="2"` 78% with on-accent text, `data-n="1"` 100% with on-accent text, `data-n="0"` `#c62828` with white text. Use `.stop-cd` with `theme-dark` so `--accent` is the dark value. Don't touch `stopCountdownRun()`'s timers. Dark on-accent text must reach 4.5:1 on each step; if not, adjust the mix percentages, not the beat.

- [ ] **Step 7: Run the e2e suites**

Run: `shot-stage`, `scale-flow`, `wake-lock`, `brew-flow`, `modals`, `touch-targets`.
Expected: PASS. `scale-flow` selectors stay valid.

- [ ] **Step 8: Commit**

### Task 9: Count of scale shots waiting to be rated

**Files:**
- Modify: `blueprints/brews.py` (before `purge_old_brews`), `static/js/brews.js`, `static/js/init.js`, `static/i18n/*.json`, `tests/test_brews.py`
- Test: `tests/test_brews.py`, `tests/e2e/shot-stage.e2e.js`

**Interfaces:**
- Consumes: `#nav-count-brews` from Task 5, `.page-summary` from Task 5.
- Produces: `GET /api/brews/pending?since=YYYY-MM-DD` returning `{"count": int}`. 400 with `error_key: 'error.coffee.invalid_date'` if `since` is missing or malformed.
- Produces: `refreshPendingCount()` in `brews.js`.
- New key: `brew.pending` (`"{count} shot{s} por valorar"` / `"{count} shot{s} to rate"`).

- [ ] **Step 1: Write the failing tests in `TestPendingBrews`**

```python
SHOT = {'main_flow': 1.5}   # plus whichever keys validation requires

def test_unrated_scale_shot_counts(client): ...          # count == 1
def test_stars_without_balance_still_counts(client): ... # rating=5 → count == 1
def test_stars_and_balance_clear_it(client): ...         # rating=5, taste_balance=0 → count == 0
def test_balance_without_stars_still_counts(client): ... # taste_balance=0 → count == 1
def test_manual_brew_never_counts(client): ...           # no shot_metrics → 0
def test_consume_never_counts(client): ...               # POST /consume → 0
def test_outside_window_does_not_count(client): ...      # brew_date before since → 0; on since → 1
def test_since_is_required_and_validated(client): ...    # missing or 'x' → 400 with error_key
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pytest tests/test_brews.py::TestPendingBrews -q`
Expected: FAIL with 404. `/api/brews/pending` isn't taken by `/api/brews/<int:bid>`.

- [ ] **Step 3: Implement the endpoint**

```sql
SELECT COUNT(*) FROM brews
WHERE shot_metrics IS NOT NULL AND brew_date >= ?
  AND (rating IS NULL OR taste_balance IS NULL)
```

- [ ] **Step 4: Run them and verify they pass**

- [ ] **Step 5: Implement `refreshPendingCount()`**

`since` is `todayLocal()` minus `QUICK_RATE_DAYS`, built with local date parts, never `toISOString()`. Sets the badge text and `hidden`, sets `aria-label` on the Prepas item, and updates the Prepas summary line when it is shown. A failed fetch hides the badge without a toast: call `fetch` directly, not `api()`. Call it from `init()`, `submitBrew()`, `afterQuickRate()` and `deleteBrew()`. Don't add `/api/brews/pending` to `CACHEABLE_API`.

- [ ] **Step 6: Add e2e assertions**

After a scale shot saved without rating, `#nav-count-brews` shows `1`. After stars and balance via "¿Qué tal estaba?", it is hidden. A manual brew leaves it hidden.

- [ ] **Step 7: Run tests and commit**

Run: `pytest -q && node --test tests/js/*.test.js`, then `shot-stage`.
Expected: PASS.

### Task 10: Prepas and ficha

**Files:**
- Modify: `static/js/brews.js:52-78,99-127,194-225`, `static/js/detail.js`, `static/js/grind-ui.js`, `static/js/taste-ui.js`, `templates/index.html:294-298,518-535`, `static/css/style.css` (Detalle, Recetas y prepas)
- Test: `tests/e2e/brew-flow.e2e.js`, `tests/e2e/grind-prediction.e2e.js`

**Interfaces:**
- Consumes: `.page-header`, `.modal`, `canvasColors`, `fmtNum`.

- [ ] **Step 1: Add e2e assertions to `brew-flow.e2e.js`**

`.btn-new-brew` is inside `.page-actions` at 1024 px and up. Brew items are one bordered list with no shadow. `quick-star` buttons and the taste scales behave as before.

- [ ] **Step 2: Run and verify they fail**

- [ ] **Step 3: Restyle per the spec's Prepas and Ficha bullets**

Keep the recipe, dial-in, grind, family, brews, inline remaining-grams edit, and save-as-recipe flows. Taste scales keep `.taste-scale`, the container query and keyboard handling. Definition rows replace the boxed grid. Long lines of metrics become labelled mono values.

- [ ] **Step 4: Run the e2e suites**

Run: `brew-flow`, `grind-prediction`, `scale-flow`, `touch-targets`, `layout-widths`.
Expected: PASS.

- [ ] **Step 5: Screenshot at 390, 820, 1280 in both themes and review against the system, then commit**

### Task 11: Stats, Catálogos and remaining modals

**Files:**
- Modify: `static/js/stats.js`, `static/js/catalog.js`, `static/js/form.js`, `templates/index.html:300-322,343-516,536-574,683-862`, `static/css/style.css` (Stats, Catálogo, Calendario, Chip input, Toast, Autocompletado, Advertencia freshness)
- Test: `tests/e2e/touch-targets.e2e.js`, `tests/e2e/layout-widths.e2e.js`, `tests/e2e/grind-prediction.e2e.js`

- [ ] **Step 1: Restyle per the spec's Remaining screens bullets**

Stats uses StatTiles, `--chart-1` bars with values at the ends, no gradients or glows. Forms cap at 720 px. Toasts use `--surface-raised`, `--shadow-2` and keep `.toast-action`. Empty states use Bodega's EmptyState pattern and keep their existing text.

- [ ] **Step 2: Remove all old token aliases and unused CSS**

Run: `grep -nE 'var\(--(text2?3?|border2?|surface[23]|accent2|accent-dim|accent-glow|green|red|amber)' static/css/style.css static/js/*.js templates/index.html`
Expected: no output.

- [ ] **Step 3: Add token rules in a new `tests/js/css.test.js`**

```js
test('no literal colours outside the token blocks', ...)   // allow #c62828 and the mix base in .stop-cd
test('no old fonts', ...)                                  // Playfair, Figtree absent from css and html
```

- [ ] **Step 4: Run all suites**

Run: `pytest -q && node --test tests/js/*.test.js`, and every e2e file.
Expected: all pass.

- [ ] **Step 5: Commit**

### Task 12: Final verification and docs

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Screenshot every screen at 390, 820 and 1280 in both themes on the local server with a copy of the data**

Screens: Cafés (normal and compact), filter panel, Prepas, Stats, Catálogos, ficha, Preparar, recipe, form, settings, pick coffee, confirm, scale test, live shot (waiting, running, finished), countdown (3, 2, 1, STOP), toast with undo, empty states. Copy the DB with SQLite's `.backup` into the scratchpad, read-only source, never modifying prod. Publish them to Fernando as a private artifact for review.

- [ ] **Step 2: Walk the action inventory by hand**

Confirm each name in `actions-baseline.json` is reachable by a visible control at 390 px. Anything hidden behind a new step gets fixed.

- [ ] **Step 3: Update `CLAUDE.md`**

Tokens and fonts, `canvasColors`, `.theme-dark`, the stage, the pending count and endpoint, nav, and the removal of emoji. Remove the "tema oscuro cálido" and "Playfair" descriptions.

- [ ] **Step 4: Run the full suites one last time, and commit**

Run: `pytest -q && node --test tests/js/*.test.js`, and every e2e file against port 5399.
Expected: all pass. Report the output.

- [ ] **Step 5: Hand over to Fernando for two things only he can do**

Review the screenshots, then pull one real shot with the scale on the Pixel using a local preview. Publishing a preview to the Pixel needs his call on how: the app needs HTTPS for Web Bluetooth, so ask rather than expose anything on the LAN. Merge only after that. The Cafeteca design system artifact follows the merge.
