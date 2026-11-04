# GoodShort Auto Next Episode

[![license](https://img.shields.io/github/license/poorloading/goodshort-auto-next-episode)](LICENSE)
[![last commit](https://img.shields.io/github/last-commit/poorloading/goodshort-auto-next-episode)](https://github.com/poorloading/goodshort-auto-next-episode/commits/main)
[![Tampermonkey](https://img.shields.io/badge/userscript-Tampermonkey-orange)](GoodShort-Auto-Next-Episode.user.js)

A Tampermonkey userscript that plays the next episode of a GoodShort series by
itself, at the highest quality the site offers. When the current episode ends it
moves straight on to the following one — no hunting for the next button, no losing
your place when a short drama ends every ninety seconds.

Works on the `dramafren.org` and `shorttw.live` mirrors — bare domain or any
subdomain. `reelfren.net` is **not supported** as of v1.7.0: the site has too
many issues, so the script no longer loads there at all.

---

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Requirements](#requirements)
- [Usage](#usage)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Privacy](#privacy)
- [Testing](#testing)
- [Changelog](#changelog)
- [License](#license)

## Features

- ⏭️ **Next episode, automatically.** Listens for the video's `ended` event and
  moves to the next episode.
- 🎬 **Moves in place where it can.** These sites already render every episode as a
  slide in one carousel, so the script steps that carousel instead of reloading the
  page. Faster, and the player keeps whatever state you set up yourself — including
  the site's own fullscreen button.
- 🔗 **Uses the site's own link when it exists.** If the page rendered a
  next-episode anchor, that's followed. Otherwise the URL's `ep` number is
  incremented as a fallback, so it still works on players that render no link.
- 🔁 **Backup for players that never fire `ended`.** A `timeupdate` check catches
  the last third of a second. It's skipped while you're seeking, so dragging the
  scrubber to the end doesn't skip an episode.
- ⏸️ **A toggle on the page.** Switch auto-advance on or off at any time; the
  state is remembered across reloads.
- 🖐️ **Your pause sticks.** Auto-play is attempted once per piece of media, not on
  every DOM change, so pausing isn't undone a moment later.
- 🔊 **Sound after autoplay is blocked.** If the browser refuses to autoplay with
  audio, playback starts muted and the sound is restored on your first click or
  key press — rather than staying silent forever.
- 🎚️ **Max quality, automatically.** Opens the player's own quality menu and picks
  the highest rendition on offer (1080p where the site has it), instead of
  settling for the 720p the player defaults to.

## Installation

### Option A — one-click (recommended)

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/)
   or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the raw script and your manager will offer to install it:
   **[Install GoodShort-Auto-Next-Episode.user.js](https://raw.githubusercontent.com/poorloading/goodshort-auto-next-episode/main/GoodShort-Auto-Next-Episode.user.js)**
3. Confirm the install, then open a GoodShort watch page — it runs automatically.

Because the script declares `@updateURL` / `@downloadURL`, your manager will
check this repository for updates on its own.

### Option B — manual

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open the extension → **Dashboard** → **+** (create a new script).
3. Replace the template with the contents of
   [`GoodShort-Auto-Next-Episode.user.js`](GoodShort-Auto-Next-Episode.user.js).
4. Save (`Ctrl`/`Cmd` + `S`) and reload the site.

> **Note:** manual installs are not auto-updated unless you keep the
> `@updateURL` header intact.

## Requirements

- A Chromium-based browser (Chrome, Edge, Brave, Opera) or Firefox
- [Tampermonkey](https://www.tampermonkey.net/) v4.0+ or
  [Violentmonkey](https://violentmonkey.github.io/) v2.12+
- Runs on `*://*.dramafren.org/*` and `*://*.shorttw.live/*` only; no special
  `@grant` permissions are requested

A `*.` host in a match pattern covers the bare domain *and* every subdomain, and
`/*` covers every path — so one entry per scheme is enough for a whole mirror.

## Usage

Once installed it runs on its own. One button sits in the bottom-right corner:

```
Auto-next: ON
```

Green means on, grey means off. The state is stored in `localStorage` under
`goodshort-auto-next-enabled`, so it survives reloads and navigation.

To watch it work, set `DEBUG = true` at the top of the script and open DevTools →
Console. Every action logs with an `[auto-next]` prefix, including the exact URL
it's navigating to and whether it advanced in place.

## Configuration

All tunables are constants at the top of the file:

| Constant | Default | Description |
| --- | --- | --- |
| `DEBUG` | `false` | Set to `true` for verbose console logging. |
| `APPLY_DELAY_MS` | `150` | Debounce window for DOM mutations before the attach pass runs. |
| `END_THRESHOLD_S` | `0.35` | How close to the end counts as "finished" for the `timeupdate` backup. |
| `MESSAGE_MS` | `4000` | How long a status message sits before reverting to the toggle label. |
| `MAX_QUALITY` | `true` | Pick the highest rendition the player offers. Set `false` to leave quality alone. |
| `QUALITY_RETRY_MS` | `400` | How often to look for the quality control while the player initialises. |
| `QUALITY_MAX_TRIES` | `15` | Retry budget (~6s) before giving up on finding a quality control. |

The episode number comes from `?ep=` on the URL and the fallback increments it, so
the script never needs to know whether a site counts from zero or one. Only the
difference matters.

If autoplay is too aggressive, `END_THRESHOLD_S` is the one to raise — a larger
value advances slightly before the video truly ends.

## How it works

Three triggers, all funnelling into one debounced pass:

1. **`ended`** on the video — the normal path. Calls `nextEpisode()`.
2. **`timeupdate`** — a backup for players that stall instead of firing `ended`.
   Skipped when `video.seeking` is true, when the video is looping, and when the
   duration isn't finite yet.
3. **`MutationObserver`** on `document.documentElement` — debounced by
   `APPLY_DELAY_MS`, so a page that mutates constantly doesn't trigger a full
   attach pass per mutation.

### Watch-page detection

The mirrors all use the same watch shape, so detection is a single check:

| Mirror | Shape |
| --- | --- |
| `dramafren.org`, `shorttw.live` | `/?page=watch&id=<id>&ep=<n>` |

A `?page=watch` param counts as a watch page. Two URLs are treated as the same
series when their path matches and, when an `id` param is present, that matches
too — in practice that means the `?id=` param identifies the series.

`nextEpisode()` does the following:

1. Bails if auto-next is off, a navigation is already in flight, or the page isn't
   a watch page.
2. Reads `?ep=` and validates it's a whole number. No `ep`, no advance.
3. Tries to **advance in place** first: these sites render one slide per episode in
   a Swiper carousel, so stepping it (`element.swiper.slideNext()`) swaps the
   episode without a page load. If the carousel is
   already on its last slide, it stops there rather than guessing a URL.
4. Falls back to the site's own next-episode anchor when there's no carousel:
   the first one pointing at the same series with `ep` one higher.
5. Falls back again to setting `ep` on the current URL, which leaves every other
   param (`id`, …) untouched.
6. Sets a `navigating` flag, shows a status message, and advances.

### Quality

The player has no API for this, and each rendition in `qualityList` carries its
own signed `auth_key`, so the stream URL can't simply be rewritten from `_720` to
`_1080` — the signature wouldn't match. The only reliable route is the site's own
quality menu, which is what a user would click anyway:

1. Find `button[aria-label="Quality"]` and click it to open the panel.
2. Read every `button.quality-option`, rank by the number in its label, and pick
   the highest.
3. If that option is already `active`, close the panel and stop — no flicker and
   no pointless reload.
4. Otherwise click it, which swaps the stream and closes the panel.

The panel is opened at most once per attempt: the trigger is a toggle, so
retrying the click would flicker it open and shut. If the player has no quality
control at all, the script retries for about six seconds and then leaves it
alone.

Quality is deliberately **independent of the auto-next toggle** — switching off
auto-advance shouldn't drop you back to 720p. Set `MAX_QUALITY = false` to turn it
off.

It's applied once per episode. An in-place advance swaps in a new `<video>` at the
player's default rendition, so the selection runs again about a second after the
slide changes. Between episodes it doesn't keep poking the menu, so if you pick a
lower quality by hand it won't fight you.

### Playback

Autoplay is attempted **once per piece of media**, not on every attach pass. That
distinction matters: the page mutates constantly, and the earlier version re-ran
`video.play()` whenever the video was paused — which silently undid your pause a
fraction of a second after you hit it. The attempt is remembered against
`video.currentSrc`, so a genuinely new episode still gets its own autoplay, while
a pause you made on purpose survives every DOM change.

The precondition is a source, not a `readyState`. A freshly mounted episode sits at
`readyState 0` until something calls `play()` — gating on readiness deadlocked, and
a loaded-but-paused video paints nothing, so the player looked black. After an
advance, playback is also nudged a few times over the next three seconds
(`PLAY_RETRY_MS`) and stops as soon as the video is actually running. That covers
the quality re-apply, which swaps the stream and resets the video to paused at 0
*after* the DOM has settled.

`navigating` is cleared on `pageshow` and `popstate`, so a back/forward navigation
can't leave the script stuck. Video listeners are tracked in a `WeakSet`, so a
`<video>` element is never wired twice and the tracking is garbage-collected with
the element.

`localStorage` access is wrapped in `try/catch` — in some privacy modes it throws
on access, and that shouldn't take the script down with it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nothing happens at the end of an episode | Confirm the script is enabled and the URL is a `?page=watch` page, then hard-reload (`Ctrl`/`Cmd` + `Shift` + `R`). |
| Toggle says OFF | Click it. The state persists, so a stray click sticks. |
| Sound is off on the next episode | Click once on the page — the browser blocks audio autoplay until you interact. |
| I pause and it starts again | Fixed in v1.5.0. If it recurs, the player is changing `currentSrc` on pause — open an issue with `DEBUG = true` output. |
| A mid-episode seek skips ahead | Shouldn't happen; the `timeupdate` backup ignores seeks. If it does, open an issue with your `DEBUG = true` output. |
| It advances but the next episode is blank | The fallback URL assumed sequential numbering and the site doesn't use it. Report the series ID. |
| Want to see what it's doing | Set `DEBUG = true` and check DevTools → Console. |

## Known limitations

- **Nothing has been verified live on the supported mirrors.** All the live
  verification (quality selection, in-place advancing, the black-screen fixes)
  was done on reelfren.net, which has since been dropped as unsupported. On
  `dramafren.org` and `shorttw.live` the script is covered only by the headless
  suite so far — playback, quality selection and the carousel advance all need
  one live confirmation. Set `DEBUG = true` and watch an episode end.
- **The quality bump relies on the player's own menu.** It looks for
  `button[aria-label="Quality"]` and `button.quality-option`; if the remaining
  mirrors' player labels those differently, quality selection won't fire
  (auto-next still works). `DEBUG = true` reports `opening quality panel` when it
  engages.
- **In-place advancing relies on a Swiper carousel.** It looks for `.watch-swiper`
  with a `swiper` instance. Where that's absent the script falls back to a normal
  navigation, which works but costs a page load and resets the player.
- **Assumes zero-based, sequential episodes.** If a series skips numbers or
  restarts numbering, the fallback URL will be wrong — though the site's own next
  link, when present, is always preferred and handles that correctly.
- **Desktop web only.** Mobile apps can't run userscripts.
- **Site markup changes.** If the page stops rendering a next link and the URL
  scheme changes too, both paths break. That's what `DEBUG = true` is for.

## Privacy

The script runs entirely in your browser. It reads the page URL, finds anchors
already on the page, drives the player's own quality menu and steps the site's own
carousel. It makes **no network requests** of its own, sends nothing anywhere, and
stores only one on/off flag in `localStorage`.

## Testing

The logic runs headlessly against a stubbed DOM — no browser, no userscript
manager, no npm dependencies:

```
node test/auto-next.test.js
```

24 assertions covering:

- following the site's own next-episode link
- the `ep` increment fallback when no link is rendered
- ignoring a next link belonging to a different series
- doing nothing when the toggle is off, or on a non-watch page, or on a watch
  page with no episode number
- not advancing when you scrub to the end (`seeking`)
- advancing from `timeupdate` when the player never fires `ended`
- not advancing a looping video
- the toggle persisting to `localStorage` and reflecting in the label
- starting switched off when the stored preference says so
- quality selection: picking the highest rendition, leaving an already-max player
  untouched, coping with a player that has no quality control, applying while
  auto-next is off, and staying out of it on a non-watch page
- advancing in place: stepping the carousel without touching `location.href`,
  stopping at the last slide instead of guessing a URL, and re-applying max
  quality once the new episode has loaded
- playback: a pause surviving another attach pass, new media still getting its own
  autoplay, a new episode being started despite mounting paused at `readyState 0`,
  and a video that has not loaded yet still getting a play attempt

The suite is checked by mutation as well as by passing: removing the autoplay
guard, the in-place advance, the quality reset, the playback nudge or the
`readyState` fix each makes its tests fail, so the assertions aren't just
decoration.

## Changelog

### v1.7.0

- **Removed: `reelfren.net` support.** The site has too many issues, so the
  script no longer loads there: both `@match` lines are gone, and the
  reelfren-only `/watch/<type>/<id>-<slug>` watch-page detection was removed
  with it. Watch-page detection is a single `?page=watch` check, which covers
  `dramafren.org` and `shorttw.live` as before.
- The reelfren-specific tests were removed; in their place a watch page with no
  `?ep=` number is explicitly covered for the remaining mirrors. 24 assertions,
  0 failed.
- Note for users of the other mirrors: all live verification so far happened on
  reelfren. The supported mirrors share the player markup in principle, but
  nothing has been checked in a real browser there yet — see **Known
  limitations**.

### v1.6.0

- **Removed: auto-fullscreen.** It caused issues in practice, so the whole
  feature is gone — the toggle, its `localStorage` flag
  (`goodshort-auto-fullscreen-enabled`), the gesture arming listener and the
  player targeting logic. If you had the toggle switched on, the script now
  leaves fullscreen entirely to the site's own Full Screen button. An in-place
  episode change still keeps that fullscreen, because no page load happens.
  The old `goodshort-auto-fullscreen-enabled` key is simply ignored; nothing
  else changes.
- Everything else is unchanged: auto-next, max quality, in-place advancing, the
  pause fix and the playback nudge all work as in v1.5.1.

### v1.5.1

- **Fixed: black screen when auto-fullscreen kicked in.** A watch page carries one
  `<section class="phone-player">` per episode — 36 of them on a 36-episode series —
  and only the active one holds a `<video>`. v1.5.0 fullscreened
  `document.querySelector('section.phone-player')`, which is episode 1's empty
  placeholder, so the browser went fullscreen onto a player with nothing in it.
  The target now comes from the video itself
  (`video.closest('section.phone-player')`), with the active slide as a fallback.
- **Fixed: black screen after auto-advancing.** The new episode mounts paused at
  `currentTime` 0, and the quality re-apply then swaps its stream, resetting it to
  paused at 0 again. A loaded-but-paused video paints nothing, so the player looked
  black. Both halves fixed:
  - `tryPlay()` required `readyState >= 2`, but a freshly mounted episode sits at
    `readyState 0` until something calls `play()` — a deadlock. Having a source is
    now the only precondition.
  - Playback is nudged over the three seconds after an advance, stopping as soon as
    the video is running, which covers the quality swap that happens after the DOM
    has settled.
- **Fullscreen no longer fights the site's own button.** If the gesture is on
  `button[aria-label="Full Screen"]`, the script stands down. Both sides read the
  same state, so handling it twice would enter fullscreen and immediately exit.
- Verified live on reelfren: `ended` → episode 6 in place, playback resumed after
  ~1.3s and stayed at 1080p, and the fullscreen target resolves to the section that
  actually contains the video while the old selector resolves to an empty one.
- Two tests added: a new episode that mounts paused and unloaded still gets started,
  and a video at `readyState 0` still gets its play attempt. The fullscreen stub now
  models 36 player sections with only the active one holding the video.

### v1.5.0

- **Fixed: turning auto-next on made the video impossible to pause.** The attach
  pass runs on every DOM change, and it called `play()` for any paused video — so
  the page's constant mutations re-started playback a fraction of a second after
  you paused. Autoplay is now attempted once per piece of media, tracked against
  `video.currentSrc`, and a new episode still gets its own attempt.
- **New: auto-fullscreen toggle.** Keeps the player fullscreen across episode
  changes. Browsers only grant fullscreen on recent user activation, so it arms a
  one-shot gesture listener and enters fullscreen on your next click or key press
  rather than pretending it can do it silently.
- **Advances in place instead of reloading.** These sites render every episode as a
  slide in one Swiper carousel, so the script now steps it (`slideNext()`) and the
  URL is updated through history. No page load — which is also what preserves
  fullscreen, since a navigation always exits it. Falls back to the link/`ep`
  navigation when there's no carousel.
- **Stops at the final episode** instead of guessing a URL past the end.
- **Quality is re-applied after an advance**, because the new episode loads at the
  player's default rendition.
- Two independent toggles now sit bottom-right; each persists its own state.
- Ten tests added for in-place advancing, fullscreen and playback.

### v1.4.0

- **Automatically picks the highest quality.** The player defaults to 720p even
  when the API's `qualityList` offers 1080p and 480p. The script now opens the
  player's own quality menu, ranks the options and selects the highest, then
  leaves it alone.
- Driving the menu rather than rewriting the stream URL is deliberate: every
  rendition has its own signed `auth_key`, so swapping `_720` for `_1080` in a URL
  produces a signature mismatch.
- If the player is already at maximum, the panel is closed again and nothing is
  re-selected, so there's no flicker.
- Quality is independent of the auto-next toggle; `MAX_QUALITY = false` disables
  it. It runs once per page load and won't argue with a manual choice.
- Verified against reelfren's live player: 720p → 1080p, video 1080×1920.
- Five tests added for the rendition selection.

### v1.3.0

- **Support `reelfren.net`'s actual URL shape.** It doesn't use the
  `?page=watch&id=…` scheme at all — watch pages are
  `/watch/<type>/<id>-<slug>?ep=<n>&lang=<cc>`. v1.2.0 added the domain but
  assumed the other mirrors' scheme, so it would have installed and then bailed
  on every page. Watch-page detection now accepts either a `?page=watch` param or
  a path starting `/watch/`.
- **Series identity is scheme-agnostic.** Two URLs belong to the same series when
  their path matches and, if an `id` param exists, that matches too. That covers
  reelfren (path carries the id) and dramafren (id lives in the query string)
  with one rule, so a next link for a different series is still ignored on both.
- **The `ep` fallback edits the URL in place**, so the path, `lang` and any other
  params survive. Previously it assumed nothing else was in the URL.
- **`?ep=` is validated as a whole number** rather than parsed loosely, so a
  watch page without an episode number no longer advances to `ep=NaN`.
- The not-a-watch-page bail now logs the path as well as the hostname.

### v1.2.0

- Added `reelfren.net` to `@match`. `*.reelfren.net` covers the bare domain and
  every subdomain, and `/*` covers every path, so both scheme lines are enough
  for the whole mirror.
- The "this isn't a watch page" bail now logs instead of disappearing at
  `DEBUG = true`, along with the hostname it's running on and the `page` value
  it found. On a new mirror that's the first thing to look at if the script
  appears to do nothing.
- Three tests added for the new mirror: a watch page advances, a subdomain is
  preserved when falling back to `ep+1`, and a non-watch page does nothing.

### v1.1.1

- Added `@updateURL` / `@downloadURL`, so installed copies auto-update. This
  needed the repository to be public — a private raw URL can't be fetched by an
  anonymous update check, which would have failed silently.
- Added `@homepageURL` / `@supportURL` and linked the namespace to the repo.

### v1.1.0

- **Debounced the `MutationObserver`.** v1.0.0 ran the whole attach pass on every
  DOM mutation — on a page that mutates continuously, that's a lot of redundant
  work. Now coalesced behind `APPLY_DELAY_MS`.
- **Fixed sound never coming back after an autoplay block.** The fallback set
  `video.muted = true` and then played, and nothing ever un-muted it, so a blocked
  autoplay meant a permanently silent episode. Sound is now restored on the first
  pointer, key or touch event.
- **Fixed scrubbing to the end skipping an episode.** The `timeupdate` backup now
  ignores seeks and looping videos.
- **Fixed `navigating` never resetting.** After one navigation the flag stayed
  true for the life of the page, which would silently stop auto-next. Now cleared
  on `pageshow` and `popstate`.
- **Guarded `localStorage`.** Access is wrapped in `try/catch`, so a privacy mode
  that throws on access no longer breaks the script.
- **Transient status messages revert.** "Loading next…" used to sit there forever;
  it now returns to the toggle label after `MESSAGE_MS`.
- **Trimmed the `@match` list.** Removed four redundant specific-host lines —
  `*://*.dramafren.org/*` and `*://*.shorttw.live/*` already cover them.
- Added `@author` and `@license` metadata.

### v1.0.0

- Initial version: auto-advance on `ended`, next-link discovery with URL
  fallback, `timeupdate` backup, on-page toggle, `localStorage` persistence.

## License

[MIT](LICENSE) © poorloading
