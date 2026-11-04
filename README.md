# GoodShort Auto Next Episode

[![license](https://img.shields.io/github/license/poorloading/goodshort-auto-next-episode)](LICENSE)
[![last commit](https://img.shields.io/github/last-commit/poorloading/goodshort-auto-next-episode)](https://github.com/poorloading/goodshort-auto-next-episode/commits/main)
[![Tampermonkey](https://img.shields.io/badge/userscript-Tampermonkey-orange)](GoodShort-Auto-Next-Episode.user.js)

A Tampermonkey userscript that plays the next episode of a GoodShort series by
itself, at the highest quality the site offers. When the current episode ends it
moves straight on to the following one — no hunting for the next button, no losing
your place when a short drama ends every ninety seconds.

Works on the `dramafren.org`, `shorttw.live` and `reelfren.net` mirrors — bare
domain or any subdomain.

---

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Requirements](#requirements)
- [Usage](#usage)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Fullscreen](#fullscreen)
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
  page. Faster, and — the reason it matters — a reload always kicks you out of
  fullscreen.
- 🔗 **Uses the site's own link when it exists.** If the page rendered a
  next-episode anchor, that's followed. Otherwise the URL's `ep` number is
  incremented as a fallback, so it still works on players that render no link.
- 🔁 **Backup for players that never fire `ended`.** A `timeupdate` check catches
  the last third of a second. It's skipped while you're seeking, so dragging the
  scrubber to the end doesn't skip an episode.
- 🔲 **Auto-fullscreen.** A second toggle puts the player fullscreen and keeps it
  there across episode changes. Browsers won't allow this without a gesture, so it
  arms itself and waits for your next click or key press — see
  [Fullscreen](#fullscreen) for the details.
- ⏸️ **Two toggles on the page.** One for auto-next, one for auto-fullscreen. Both
  remember their state across reloads.
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
- Runs on `*://*.dramafren.org/*`, `*://*.shorttw.live/*` and
  `*://*.reelfren.net/*`; no special `@grant` permissions are requested

A `*.` host in a match pattern covers the bare domain *and* every subdomain, and
`/*` covers every path — so one entry per scheme is enough for a whole mirror.

## Usage

Once installed it runs on its own. Two buttons sit in the bottom-right corner:

```
Auto-next: ON        Auto-fullscreen: ON
```

Green means on, grey means off. Each state is stored in `localStorage` under
`goodshort-auto-next-enabled` and `goodshort-auto-fullscreen-enabled`, so both
survive reloads and navigation.

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

The mirrors don't agree on URL shape, so both are recognised:

| Mirror | Shape |
| --- | --- |
| `dramafren.org`, `shorttw.live` | `/?page=watch&id=<id>&ep=<n>` |
| `reelfren.net` | `/watch/<type>/<id>-<slug>?ep=<n>&lang=<cc>` |

Either a `?page=watch` param, or a path beginning `/watch/`, counts as a watch
page. Two URLs are treated as the same series if their **path** matches and, when
an `id` param is present, that matches too — so `reelfren.net` is identified by
its path and `dramafren.org` by its query string, without either rule breaking the
other.

`nextEpisode()` does the following:

1. Bails if auto-next is off, a navigation is already in flight, or the page isn't
   a watch page.
2. Reads `?ep=` and validates it's a whole number. No `ep`, no advance.
3. Tries to **advance in place** first: these sites render one slide per episode in
   a Swiper carousel, so stepping it (`element.swiper.slideNext()`) swaps the
   episode without a page load — and without losing fullscreen. If the carousel is
   already on its last slide, it stops there rather than guessing a URL.
4. Falls back to the site's own next-episode anchor when there's no carousel:
   the first one pointing at the same series with `ep` one higher.
5. Falls back again to setting `ep` on the current URL, which leaves the path and
   every other param (`lang`, `id`, …) untouched.
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

`navigating` is cleared on `pageshow` and `popstate`, so a back/forward navigation
can't leave the script stuck. Video listeners are tracked in a `WeakSet`, so a
`<video>` element is never wired twice and the tracking is garbage-collected with
the element.

`localStorage` access is wrapped in `try/catch` — in some privacy modes it throws
on access, and that shouldn't take the script down with it.

### Fullscreen

This one is constrained by the browser, not by the site. `requestFullscreen()`
requires **recent user activation**: a script call with no gesture behind it is
simply refused, and any page navigation drops you out of fullscreen.

So auto-fullscreen can't be silent, and the script doesn't pretend otherwise:

1. It arms a one-shot listener for the next `pointerdown`, `keydown` or
   `touchstart`, then removes it.
2. On that gesture it calls `requestFullscreen()` on the player
   (`section.phone-player`), which the browser accepts because a real gesture just
   happened.
3. After an in-place advance it arms again, in case the player dropped out anyway.

The practical effect: with the toggle on, the next click or key press anywhere puts
you fullscreen, and in-place advancing keeps you there across episodes. Turning the
toggle on mid-episode arms it straight away, so it takes effect on your next click
rather than at the next reload.

If a mirror has no carousel — `advanceInPlace()` returns false — the script falls
back to a real navigation, and that will exit fullscreen no matter what, because
the page is genuinely reloading.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nothing happens at the end of an episode | Confirm the script is enabled and the URL is a `?page=watch` page, then hard-reload (`Ctrl`/`Cmd` + `Shift` + `R`). |
| Toggle says OFF | Click it. The state persists, so a stray click sticks. |
| Sound is off on the next episode | Click once on the page — the browser blocks audio autoplay until you interact. |
| It goes fullscreen as soon as I click anything | That's auto-fullscreen doing its job: browsers only grant fullscreen on a gesture. Click the `Auto-fullscreen` button to turn it off. |
| Fullscreen still drops on some mirrors | Only the carousel advance keeps it. If that mirror reloads for the next episode, the browser ends fullscreen and a script can't take you back without another gesture. |
| I pause and it starts again | Fixed in v1.5.0. If it recurs, the player is changing `currentSrc` on pause — open an issue with `DEBUG = true` output. |
| A mid-episode seek skips ahead | Shouldn't happen; the `timeupdate` backup ignores seeks. If it does, open an issue with your `DEBUG = true` output. |
| It advances but the next episode is blank | The fallback URL assumed sequential numbering and the site doesn't use it. Report the series ID. |
| Want to see what it's doing | Set `DEBUG = true` and check DevTools → Console. |

## Known limitations

- **Auto-advance is tested by reasoning, not on a live session.** The logic is
  covered by a headless suite, and both quality selection and in-place advancing
  were confirmed against reelfren's live player, but nobody has yet watched an
  episode end and advance automatically in a real browser. Confirm it once with
  `DEBUG = true`.
- **Auto-fullscreen needs a gesture, and a reload ends it.** No userscript can
  enter fullscreen silently — that's a browser rule, not a bug here. It also can't
  survive a page navigation, so it only holds across episode changes when the site
  advances in place. This could not be verified in an embedded browser (fullscreen
  requests never settle there); it needs a real Chrome session to confirm.
- **The quality bump relies on the player's own menu.** It looks for
  `button[aria-label="Quality"]` and `button.quality-option`. Verified on
  reelfren's player; if another mirror's player labels those differently, quality
  selection won't fire (auto-next still works). `DEBUG = true` reports
  `opening quality panel` when it engages.
- **In-place advancing relies on a Swiper carousel.** It looks for `.watch-swiper`
  with a `swiper` instance. Where that's absent the script falls back to a normal
  navigation, which works but costs you fullscreen and a page load.
- **Assumes zero-based, sequential episodes.** If a series skips numbers or
  restarts numbering, the fallback URL will be wrong — though the site's own next
  link, when present, is always preferred and handles that correctly.
- **Desktop web only.** Mobile apps can't run userscripts.
- **Site markup changes.** If the page stops rendering a next link and the URL
  scheme changes too, both paths break. That's what `DEBUG = true` is for.

## Privacy

The script runs entirely in your browser. It reads the page URL, finds anchors
already on the page, drives the player's own quality menu, steps the site's own
carousel, and asks the browser for fullscreen after one of your gestures. It makes
**no network requests** of its own, sends nothing anywhere, and stores only two
on/off flags in `localStorage`.

## Testing

The logic runs headlessly against a stubbed DOM — no browser, no userscript
manager, no npm dependencies:

```
node test/auto-next.test.js
```

32 assertions covering:

- following the site's own next-episode link
- the `ep` increment fallback when no link is rendered
- ignoring a next link belonging to a different series
- doing nothing when the toggle is off, or on a non-watch page
- not advancing when you scrub to the end (`seeking`)
- advancing from `timeupdate` when the player never fires `ended`
- not advancing a looping video
- the toggle persisting to `localStorage` and reflecting in the label
- starting switched off when the stored preference says so
- on `reelfren.net`'s path-based URLs: bumping `?ep=` while keeping `?lang=`,
  preferring the page's own next link, ignoring a link to a different series,
  preserving the subdomain, doing nothing off a watch page, and doing nothing
  when `?ep=` is absent
- quality selection: picking the highest rendition, leaving an already-max player
  untouched, coping with a player that has no quality control, applying while
  auto-next is off, and staying out of it on a non-watch page
- advancing in place: stepping the carousel without touching `location.href`,
  stopping at the last slide instead of guessing a URL, and re-applying max
  quality once the new episode has loaded
- auto-fullscreen: arming without a gesture, entering on the next one, not asking
  twice when already fullscreen, doing nothing while switched off, staying out of it
  off a watch page, and the toggle persisting
- playback: a pause surviving another attach pass, and new media still getting its
  own autoplay

The suite is checked by mutation as well as by passing: removing the autoplay
guard, the in-place advance, the fullscreen arming or the quality reset each makes
its tests fail, so the assertions aren't just decoration.

## Changelog

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
