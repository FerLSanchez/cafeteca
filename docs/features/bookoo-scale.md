# Feature spec — Bookoo Themis Mini integration (Web Bluetooth)

> Status: **F0 in progress.** The Scale lab (Settings → "Scale lab (beta)") is shipped: connect, live parsed values, tare, record dose/shot frames and download them as JSON. Next: the owner records captures on the Pixel and they are committed to `tests/js/fixtures/`.
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
3. **Auto-lock:** when the weight is **stable** (±0.1 g for 1 s) and above 1 g, the value is fixed to one decimal and the field shows a ✓. Tapping ⚖️ again re-reads it.
4. The value stays editable by hand, and the recipe value is still the default if the scale is not used.

### 5.2 Shot (auto mode) → yield + time

1. After the dose is set, a **"Wait for shot"** state appears (in the same modal, or as a live-shot overlay): "Switch the scale to auto mode and pull your shot".
2. The **shot starts** when the timer goes from 0 to increasing, or on a `0D`/`01` event. The live view shows the scale's timer, weight, flow (g/s) and the live **ratio against the dose**, plus a progress bar towards the recipe's target yield if one exists.
3. The **shot ends** when the timer stays unchanged for about 1.5 s, or on a `0D`/`00` event.
4. **Settle:** keep reading for about 3 s and take the stable weight as the yield. The time is the scale's final timer in seconds.
5. The fields are filled in: **dose** (from 5.1, or the recipe, or `grams_per_shot`), **yield**, **time**, and grind/temperature from the recipe. The ratio and flow display updates via `updateBrewRatioDisplay()`. You add a rating and notes, and save through the existing `POST /api/coffees/:id/brews` (which deducts `dose_g` from stock if the bag is open).

### 5.3 Other touches

- A **connection chip** in the nav, e.g. "⚖️ 87 %" (battery). Tapping it disconnects. A toast appears on unexpected disconnect.
- **Optional, later:** a "continuous mode" that drafts a brew for every shot while connected.

## 6. Technical design

| Piece | Detail |
|---|---|
| `static/js/scale.js` (new) | Holds the connection state. `scaleConnect()` requests the device (filter `services:[0x0ffe]`), connects GATT, and starts notifications on `0xff11`. `scaleTare()` writes `01`. There is an `EventTarget`-style bus for the events `scale:weight {ms, weight, flow, battery}`, `scale:event {state, ms, weight, avg}`, `scale:connected` and `scale:disconnected`. |
| `parseScalePacket(DataView)` | A pure function: it validates the length and checksum and returns a typed object or `null`. It is **unit-tested with `node --test`** against real frames captured in F0 (`tests/js/fixtures/*.json`). |
| Detectors | Pure functions too: `stableWeight(samples)` for the dose, and a `ShotDetector` state machine (idle → running → settling → done) fed with samples. Unit-tested with recorded shots. |
| Simulator | `?scale=sim` swaps the BLE layer for a replay of the F0 captures. It is used for development, demos and a **Playwright** test of the whole flow. |
| UI | Changes to the brew modal in `templates/index.html` and `static/js/brews.js`, plus a live-shot overlay. Load `scale.js` after `utils.js`, and add it to the SW `SHELL` in `static/sw.js`. |
| i18n | A new `scale.*` group in `static/i18n/es.json` **and** `en.json` (connect, tare, waiting, live, settling, not supported, disconnected…). |
| Backend | **No changes for F1.** In F2, `migrate_v9()` adds `brews.shot_curve TEXT`: JSON downsampled to about 5 Hz, `[[t_ms, g, flow], …]`, roughly 2–3 KB per shot. It is accepted and validated by `validate_brew()` and returned by the brew endpoints. |

## 7. Phases

| Phase | Scope | Done when | Effort |
|---|---|---|---|
| **F0: Spike** | A hidden "Scale lab" section in Settings: connect, show live parsed values, and **download the raw frames as JSON**. The owner records one dose weighing and 2–3 auto-mode shots. | Sign-byte encoding and packet rate are confirmed, we know whether `0D` is emitted, and the fixtures are committed. | S |
| **F1: MVP** | A **scale test page** in the app (grown from the Scale lab) to try both modes: normal (live weight, tare, stability lock) and auto (live shot view with timer, weight, flow). §5.1 dose + §5.2 shot + §5.3 chip; parser/detectors with unit tests; simulator + Playwright test. | A full routine on the Pixel produces a correct brew with no typing (except the rating). | M |
| **F2: Curves** | Store `shot_curve`; show a sparkline in the brew rows; overlay the best-rated shot of the same coffee (feeds PM-06 dial-in). | Curves are visible for new brews. | M |
| **F3: Extras** | Use `0D` events if F0 found them; continuous mode; low-battery hint. | — | S |

## 8. Risks and open points

- ⚠️ **Sign bytes:** undocumented (indices 6 and 10). F0 settles them.
- ⚠️ **Auto-mode events on the Mini:** undocumented, so timer-based detection is the baseline. Optionally ask `develop@bookoocoffee.com`.
- ⚠️ **Packet rate** is unknown (probably around 10 Hz). The detector thresholds (1.5 s freeze, 3 s settle, ±0.1 g stability) need tuning with F0 data.
- ⚠️ **Official app:** it must be closed or disconnected while Cafeteca is in use.
- 💬 **Auto-mode UX to be agreed with the owner before F1:** flow is a key metric, so the live-shot view (flow curve vs. weight, target flow band, how flow is summarised in the saved brew) needs agreeing first.
- ℹ️ The app cannot know the scale's mode (normal or auto); it's not in the `0B` packet. The UX relies on the step the user is in (dose button vs. waiting for shot), not on detecting the mode.
- ℹ️ Related backlog: **ENG-04** (stock deducted by `grams_per_shot` vs. the brew's `dose_g`) becomes more visible once real doses are recorded. Consider fixing it before or together with F1.
