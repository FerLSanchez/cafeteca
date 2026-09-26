# Feature spec — Bookoo Themis Mini integration (Web Bluetooth)

> Status: **F1 + F2 implemented** (2026-09-26), plus the F3 low-battery hint. F0 findings in §8. Pending: validation on the Pixel with real shots.
> Backlog code: **PM-14** in [`docs/REVIEW-2026-09.md`](../REVIEW-2026-09.md) §6.
> Protocol source: [BooKooCode/OpenSource](https://github.com/BooKooCode/OpenSource) (MIT), files `bookoo_mini_scale/protocols.md` and `bookoo_ultra_scale/protocols.md`.

## 1. Goal

Remove manual typing from the daily espresso routine. Cafeteca reads the owner's **Bookoo Themis Mini** over Bluetooth and fills a brew's **dose**, **yield** and **time** (plus the flow curve, later) by itself.

## 2. Owner's setup (confirmed)

| Item | Value |
|---|---|
| Scale | **Bookoo Themis Mini**, latest firmware |
| Phone | **Google Pixel Pro (Android)** → Chrome and the installed PWA support Web Bluetooth ✅ |
| Access | `cafeteca.fersanchez.com` behind Authelia forward-auth (NPM) with TLS — live since PR #47. HTTPS is required by Web Bluetooth. `/static/` is served without auth, `/api/` returns 401 when the session expires |
| Routine, step 1: **dose** | Scale in **normal (weight) mode**. The ground coffee (beans) is weighed, and that number is the brew form's **"Café (g)"** field (`b-dose` → `dose_g`). |
| Routine, step 2: **shot** | Scale in **auto mode**. It tares when it detects the cup, starts the timer when flow begins, and stops it when flow ends. This gives **yield** (`yield_g`) and **time** (`time_s`). |

## 3. Platform facts

- **API:** Web Bluetooth (`navigator.bluetooth`), GATT client. It works in a Chrome tab and in the installed PWA.
- **Choosing the scale:** `requestDevice()` needs a **user gesture**. Expect **one chooser tap per session**, because reconnecting silently (`getDevices()`) is not reliably available. Once connected, keep the connection for the life of the page, so both steps (dose and shot) reuse it.
- **One connection at a time:** the scale accepts a single central, so the **official Bookoo app must be disconnected**.
- **Screen:** use the Screen Wake Lock API during the live shot so the screen doesn't turn off.
- **CSP:** no change needed; Web Bluetooth is not governed by `connect-src`.
- **Other browsers:** iOS and Firefox have no Web Bluetooth. Hide the scale buttons when `!('bluetooth' in navigator)`.

## 4. Protocol (Mini; the core is shared with the Ultra)

- **Service** `0x0FFE` → `00000ffe-0000-1000-8000-00805f9b34fb`.
- **Characteristics:** `0xFF11` sends weight **notifications**; `0xFF12` receives **commands** (write).
- **Checksum:** the last byte is the XOR of all the bytes before it.

### 4.1 Commands `03 0A <cmd> <d1> <d2> <xor>`

| Cmd | Meaning | Frame |
|---|---|---|
| `01` | Tare | `03 0A 01 00 00 08` |
| `04` | Start timer | `03 0A 04 00 00 0D` |
| `05` | Stop timer | `03 0A 05 00 00 0C` |
| `06` | Reset timer | `03 0A 06 00 00 0F` |
| `07` | Tare + start timer | `03 0A 07 00 00 0E` |
| `08` | Flow smoothing off/on (`d1` = 00/01) | `03 0A 08 01 00 00` |

Only **Tare** (`01`) is needed, in the dose step. **Never send commands during an auto-mode shot**: the scale is in charge there.

### 4.2 Weight notification, type `0B` (20 bytes, 0-based index)

| Idx | Field |
|---|---|
| 0 | `0x03` (product) |
| 1 | `0x0B` (type) |
| 2–4 | Timer in **ms** (uint24, big-endian) |
| 5 | Unit |
| 6 | Weight sign ⚠️ encoding not documented (probably ASCII `+` `0x2B` / `-` `0x2D`) |
| 7–9 | **Weight × 100** in grams (uint24, big-endian) |
| 10 | Flow sign ⚠️ same as index 6 |
| 11–12 | **Flow × 100** in g/s (uint16, big-endian) |
| 13 | Battery % |
| 14–15 | Standby time (min × 10) |
| 16 | Buzzer level |
| 17 | Flow smoothing on/off |
| 18 | Reserved |
| 19 | Checksum |

### 4.3 Ultra-only packets (maybe emitted by the Mini; **F0 must check**)

- **`0F`: powder weight.** Not relevant here, because the owner weighs the dose separately in normal mode.
- **`0D`: auto-mode event.**
  - Idx 2 is the state: `00` stopped, `01` started, `02` ready, `03` exit ready, `04` exit done.
  - Idx 3–5: ms.
  - Idx 6: weight sign.
  - Idx 7–9: weight × 100.
  - Idx 10: result sign.
  - Idx 11–12: average flow (or ratio) × 100.
  - If it arrives, use state `00` as the authoritative "shot finished" signal.

## 5. User experience

### 5.1 Dose (normal mode) → "Café (g)" field

1. In the brew modal, a **⚖️ button** next to "Café (g)" connects if needed and switches the field to **live mode**, where it follows the scale weight in real time.
2. Show a small **"Tare"** link (command `01`) for when the container is already on the scale.
3. **No early auto-lock** (the F0 capture showed 17.8 g holding still for ~0.6 s while the owner was still adjusting towards 17.0). The field follows the live weight and **freezes on the last stable value (≥1 s, ≥1 g) when the container is lifted** (weight drops towards 0 or negative), or when ✓ is tapped. Brief spikes (hand on the scale, 700+ g) are ignored. ✅ Agreed with the owner.
4. The value stays editable by hand, and the recipe value is still the default if the scale is not used.

### 5.2 Shot (auto mode) → yield + time

1. After the dose is set, a **"Wait for shot"** state appears (in the same modal, or as a live-shot overlay): "Switch the scale to auto mode and pull your shot".
2. The **shot starts** when the timer goes from 0 to > 0 (the Mini sends no `0D` events). Placing the cup is **not** a start signal: the scale shows the cup's weight (~143 g) for ~1–2 s and auto-tares to 0 with the timer still at 0. The live view shows the scale's timer, weight, flow (g/s) and the live **ratio against the dose**, plus a progress bar towards the recipe's target yield if one exists.
3. The **shot ends** when the timer **drops from > 0 back to 0** (confirmed in F0). The scale does this after ~4–5 s of near-zero flow, so the tail is already included.
4. **Result = the last frame before the reset:** yield = its weight, time = its `ms`. No extra settle wait is needed. The weight is auto-tared to 0 one packet later, and later drips accumulate on the new zero.
5. The fields are filled in: **dose** (from 5.1, or the recipe, or `grams_per_shot`), **yield**, **time**, and grind/temperature from the recipe. The ratio and flow display updates via `updateBrewRatioDisplay()`. You add a rating and notes, and save through the existing `POST /api/coffees/:id/brews` (which deducts `dose_g` from stock if the bag is open).

### 5.3 Other touches

- A **connection chip** in the nav, e.g. "⚖️ 87 %" (battery). Tapping it disconnects. A toast appears on unexpected disconnect.
- **Optional, later:** a "continuous mode" that drafts a brew for every shot while connected.

### 5.4 Flow analysis (agreed with the owner, 2026-09-25)

The scale only reports the **overall average** (yield ÷ time), which mixes the slow ramp, the main flow and the dripping tail. The app keeps the full curve **in memory during the shot** and derives finer metrics from it. **The curve itself is not stored.**

A real shot at a 1.5 g/s target looks like this: a slow start → it ramps up to the target → it overshoots for a few seconds → it falls back → it ends at almost 0 with the last drops.

**Phases.** They are detected on the smoothed flow (moving average ≈ 1 s). The thresholds are tuned with F0 captures.

| Phase | Detection |
|---|---|
| **Pre-infusion** | not measurable: the scale starts its timer at the first drops (back-dated ~1 s), not at the pump start. The shot time is therefore "time since first drops" |
| **Ramp** | first drops → flow reaches ~90 % of the target (or of the peak if there is no target) |
| **Main** | from the end of the ramp until the flow drops below ~50 % of the target/peak for good |
| **Tail** | the end of main → stop (last drops) |

**Metrics saved with the brew** (a small object, a few hundred bytes):

| Metric | Meaning |
|---|---|
| `t_ramp_s` | ramp duration (how long it takes to reach the target) |
| `main_flow` | **mean flow during the main phase**: the "real" flow, which is what you actually dial in |
| `peak_flow`, `t_peak_s` | the maximum flow and when it happens |
| `overshoot_s` | seconds above target + tolerance |
| `in_band_pct` | % of the main phase within target ± tolerance |
| `flow_cv` | flow variability in the main phase (std/mean): stability |
| `tail_s`, `tail_g` | length of the tail and the grams added in it |
| `irregular` | boolean: a sudden flow spike **or dip** in the main phase (possible channeling / puck event) |
| `avg_flow` | the scale's overall average, kept for reference |

**Target.** A new optional recipe field, `target_flow` (g/s), set per coffee. It has a default tolerance of ±0.2 g/s (✅ confirmed by the owner), which can be changed in Settings. Without a target, the metrics that depend on it are left empty and the phases use the peak instead.

**Live view (auto mode).** It shows a live flow curve with the target band shaded, the current flow in large type, and the weight/ratio plus timer. When the shot ends, a summary card lists the metrics above, with a one-line comparison against the best-rated brew of the same coffee (e.g. "main flow 1.62 vs 1.48 g/s, ramp +2 s").

**Flow source (✅ confirmed).** The app computes flow itself from the weight derivative (consistent and independent of the scale's smoothing setting). The scale's reported flow is only used to cross-check it in the F0 captures.

## 6. Technical design

| Piece | Detail |
|---|---|
| `static/js/scale.js` (new) | Holds the connection state. `scaleConnect()` requests the device (filter `services:[0x0ffe]`), connects GATT, and starts notifications on `0xff11`. `scaleTare()` writes `01`. There is an `EventTarget`-style bus for the events `scale:weight {ms, weight, flow, battery}`, `scale:event {state, ms, weight, avg}`, `scale:connected` and `scale:disconnected`. |
| `parseScalePacket(DataView)` | A pure function: it validates the length and checksum and returns a typed object or `null`. It is **unit-tested with `node --test`** against real frames captured in F0 (`tests/js/fixtures/*.json`). |
| Detectors | Pure functions too: `stableWeight(samples)` for the dose, and a `ShotDetector` state machine (idle → running → settling → done) fed with samples. Unit-tested with recorded shots. |
| Simulator | `?scale=sim` swaps the BLE layer for a replay of the F0 captures. It is used for development, demos and a **Playwright** test of the whole flow. |
| UI | Changes to the brew modal in `templates/index.html` and `static/js/brews.js`, plus a live-shot overlay. Load `scale.js` after `utils.js`, and add it to the SW `SHELL` in `static/sw.js`. |
| i18n | A new `scale.*` group in `static/i18n/es.json` **and** `en.json` (connect, tare, waiting, live, settling, not supported, disconnected…). |
| Backend | F1: `migrate_v9()` adds `brews.shot_metrics TEXT` (JSON with the §5.4 metrics, validated by `validate_brew()`, returned by the brew endpoints) and `recipes.target_flow REAL`. **No raw curve is stored.** |

## 7. Phases

| Phase | Scope | Done when | Effort |
|---|---|---|---|
| **F0: Spike** | A hidden "Scale lab" section in Settings: connect, show live parsed values, and **download the raw frames as JSON**. The owner records one dose weighing and 2–3 auto-mode shots. | Sign-byte encoding and packet rate are confirmed, we know whether `0D` is emitted, and the fixtures are committed. | S |
| **F1: MVP** | §5.4 flow analysis (pure `analyzeShot(samples, target)`, unit-tested on F0 captures). A **scale test page** in the app (grown from the Scale lab) to try both modes: normal (live weight, tare, stability lock) and auto (live shot view with timer, weight, flow). §5.1 dose + §5.2 shot + §5.3 chip; parser/detectors with unit tests; simulator + Playwright test. | A full routine on the Pixel produces a correct brew with no typing (except the rating). | M |
| **F2: Dial-in** | Show the §5.4 metrics in the brew rows and detail; per-coffee trends (main flow vs. rating) and the comparison against the best-rated shot (feeds PM-06 dial-in). | Metrics are visible for new brews. | M |
| **F3: Extras** | Use `0D` events if F0 found them; continuous mode; low-battery hint. | — | S |

## 8. F0 findings (first capture, 2026-09-25, finger-pressed, `tests/js/fixtures/f0-finger-2026-09-25.json`)

- ✅ **Sign bytes are ASCII** `+` (`0x2B`) / `-` (`0x2D`), as confirmed by negative flow values. No negative weight has been seen yet.
- ✅ **Packet rate ≈ 11 Hz** (median gap 90 ms, p10–p90 86–123 ms).
- ✅ **No `0D`/`0F` packets** from the Mini (this firmware), so the timer-based detection is the path.
- ✅ Other fields: `unit`=1 (g), flow smoothing off (`17`=0), buzzer 0, standby 5 min.
- ℹ️ **Timer resolution is 100 ms.** In auto mode, the first non-zero reading was already **1.1 s**: the scale back-dates the start to when the flow began. Use the scale's `ms` as the shot time, not our own clock.
- ✅ Auto-stop: see §8.1 (the timer resets to 0 at the end).
- ℹ️ In the finger test, the scale's flow looked lagging. In the real shot, it matches our own 1 s-regression flow within ~0.1–0.2 g/s, so both are usable. We still compute our own (as agreed), and the scale's flow is a cross-check.
- 🔧 Lab fix: recordings after "Stop" reused a new `t0`, so the timestamps overlapped. `t0` is now kept until "Clear", and each frame carries a `session` number.
- **Still needed:** 1 real dose + 2–3 real auto-mode shots.

### 8.1 First real shot (2026-09-26, `tests/js/fixtures/f0-real-2026-09-26.json`)

- **Dose:** 17.0 g. The owner overshot to 17.9 g, removed beans and settled at 17.0. There was one ~760 g spike while handling the container.
- **Shot:** 38.5 g in 27.8 s (scale time) → the scale's average is **1.38 g/s**.
- **Flow profile** (owner's target ≈ 1.5 g/s): 1.2–1.4 g/s for the first ~6 s → ~1.7 g/s at 8–10 s → a **dip to ~1.1 g/s at ~11.5 s** (nothing was touched; it shows in the weight itself, not only in the scale's flow, so it is a real slowdown or a weighing artefact, not flow-sensor noise. The analysis should flag dips as well as spikes as "irregular flow") → a rise to **2.0–2.2 g/s from ~15 s to 22 s** → it falls at 22.3 s → a **tail of ~5.5 s adding ~1.4 g**.
- **Main-phase flow ≈ 1.73 g/s** (5.6 → 37.1 g between 4 s and 22.2 s), versus the scale's 1.38. This is exactly the gap §5.4 is meant to show.
- **Packet rate:** the same ~11 Hz during the shot. The timer advances in 100 ms steps.
- The shot is kept as a fixture; a test asserts the end-of-shot semantics.

## 8.2 F1 implementation notes

- `static/js/scale-analysis.js` (pure, node-tested): `DoseTracker`, `ShotTracker`, `flowSeries` (1 s linear regression), `analyzeShot`.
  Thresholds: ramp end = flow ≥ 90 % of the reference held for 1 s; tail = flow < 50 % of the reference; irregular = deviation > 25 % from the 3 s local median held for 0.3 s, excluding the edges of the main phase. Reference = the target if the shot reaches it, otherwise the median of the flow ≥ 50 % of the peak. **These are tuned on a single real shot; re-check with more captures.**
- `static/js/scale-ui.js`: nav chip, ⚖️ dose in the brew modal, "⏱ Shot with scale" → live-shot modal (curve + band, summary, comparison with the best-rated shot of the same coffee), and the **scale test page** (Settings → "⚖️ Test scale": normal/auto tabs, frame capture).
- Backend: `migrate_v9` (`brews.shot_metrics` JSON, `recipes.target_flow`), `flow_tolerance` setting.
- E2E: `tests/e2e/scale-flow.e2e.js` replays the real capture through a fake Web Bluetooth device (not in CI).
- Deviation from §6: there is no in-app `?scale=sim` simulator; the replay lives in the E2E harness.

## 8.3 F2 implementation notes

- Brew rows (coffee detail and the Brews tab) show a second line: 🌊 ramp · % in band · peak · tail. The summary line shows the main flow (⚠️ if irregular).
- Editing a brew with metrics shows the full metrics card in the brew modal (and so does a new brew after "Usar resultado").
- Coffee detail → **Dial-in** section (≥ 2 shots with metrics): a scatter of main flow vs rating with the target band shaded (latest highlighted, irregular shots ringed in red), plus lines for your best-rated shots' main flow/ramp range, shots in band, and irregular shots.
- F3 low-battery hint: the chip turns red at ≤ 15 %, with one toast per session. Continuous mode is still open.

## 9. Risks and open points

- ✅ **Sign bytes:** ASCII, see §8.
- ✅ **Auto-mode events on the Mini:** none are sent; timer-based detection is enough (§8.1).
- ✅ **Packet rate** ≈ 11 Hz. The end of shot is the timer reset, so no freeze/settle thresholds are needed.
- ⚠️ **Official app:** it must be closed or disconnected while Cafeteca is in use.
- ✅ Auto-mode UX agreed: see §5.4. Thresholds are pending tuning with F0 captures.
- ℹ️ The app cannot know the scale's mode (normal or auto); it's not in the `0B` packet. The UX relies on the step the user is in (dose button vs. waiting for shot), not on detecting the mode.
- ℹ️ Related backlog: **ENG-04** (stock deducted by `grams_per_shot` vs. the brew's `dose_g`) becomes more visible once real doses are recorded. Consider fixing it before or together with F1.
