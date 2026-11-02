# GoodShort Auto Next Episode

[![license](https://img.shields.io/github/license/poorloading/goodshort-auto-next-episode)](LICENSE)
[![last commit](https://img.shields.io/github/last-commit/poorloading/goodshort-auto-next-episode)](https://github.com/poorloading/goodshort-auto-next-episode/commits/main)
[![Tampermonkey](https://img.shields.io/badge/userscript-Tampermonkey-orange)](GoodShort-Auto-Next-Episode.user.js)

A Tampermonkey userscript that plays the next episode of a GoodShort series by
itself. When the current episode ends, it opens the following one — no hunting
for the next button, no losing your place when a short drama ends every ninety
seconds.

Works on the `dramafren.org` and `shorttw.live` mirrors.

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
  opens the next episode immediately.
- 🔗 **Uses the site's own link when it exists.** If the page rendered a
  next-episode anchor, that's followed. Otherwise the URL's `ep` number is
  incremented as a fallback, so it still works on players that render no link.
- 🔁 **Backup for players that never fire `ended`.** A `timeupdate` check catches
  the last third of a second. It's skipped while you're seeking, so dragging the
  scrubber to the end doesn't skip an episode.
- ⏸️ **Toggle on the page.** A small button in the corner switches it off and
  remembers the choice across reloads.
- 🔊 **Sound after autoplay is blocked.** If the browser refuses to autoplay with
  audio, playback starts muted and the sound is restored on your first click or
  key press — rather than staying silent forever.

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
- Runs on `*://*.dramafren.org/*` and `*://*.shorttw.live/*`; no special `@grant`
  permissions are requested

## Usage

Once installed it runs on its own. The toggle sits bottom-right:

```
Auto-next: ON (click to toggle)
```

Green means on, grey means off. The state is stored in `localStorage` under
`goodshort-auto-next-enabled`, so it survives reloads and navigation.

To watch it work, set `DEBUG = true` at the top of the script and open DevTools →
Console. Every action logs with an `[auto-next]` prefix, including the exact URL
it's navigating to.

## Configuration

All tunables are constants at the top of the file:

| Constant | Default | Description |
| --- | --- | --- |
| `DEBUG` | `false` | Set to `true` for verbose console logging. |
| `APPLY_DELAY_MS` | `150` | Debounce window for DOM mutations before the attach pass runs. |
| `END_THRESHOLD_S` | `0.35` | How close to the end counts as "finished" for the `timeupdate` backup. |
| `MESSAGE_MS` | `4000` | How long a status message sits before reverting to the toggle label. |

Episodes are numbered from zero in the URL (`&ep=0` is the first episode), which
is why the fallback increments rather than reads an episode count.

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

`nextEpisode()` does the following:

1. Bails if auto-next is off, a navigation is already in flight, or the page isn't
   a watch page (`?page=watch`).
2. Reads the episode number from the URL and validates it's a non-negative
   integer.
3. Looks for an anchor on the page pointing at the same `id` with `ep` one higher
   — the site's own next-episode link. Falls back to rewriting the URL.
4. Sets a `navigating` flag, shows a status message, and navigates.

The flag is cleared on `pageshow` and `popstate`, so a back/forward navigation
can't leave it stuck. Video listeners are tracked in a `WeakSet`, so a `<video>`
element is never wired twice and the tracking is garbage-collected with the
element.

`localStorage` access is wrapped in `try/catch` — in some privacy modes it throws
on access, and that shouldn't take the script down with it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nothing happens at the end of an episode | Confirm the script is enabled and the URL is a `?page=watch` page, then hard-reload (`Ctrl`/`Cmd` + `Shift` + `R`). |
| Toggle says OFF | Click it. The state persists, so a stray click sticks. |
| Sound is off on the next episode | Click once on the page — the browser blocks audio autoplay until you interact. |
| A mid-episode seek skips ahead | Shouldn't happen; the `timeupdate` backup ignores seeks. If it does, open an issue with your `DEBUG = true` output. |
| It advances but the next episode is blank | The fallback URL assumed sequential numbering and the site doesn't use it. Report the series ID. |
| Want to see what it's doing | Set `DEBUG = true` and check DevTools → Console. |

## Known limitations

- **Tested by reasoning, not on the live site.** The logic is covered by a
  headless test suite, but it has not been run against a real GoodShort session
  yet. Confirm it once with `DEBUG = true` before trusting it.
- **Assumes zero-based, sequential episodes.** If a series skips numbers or
  restarts numbering, the fallback URL will be wrong — though the site's own next
  link, when present, is always preferred and handles that correctly.
- **Desktop web only.** Mobile apps can't run userscripts.
- **Site markup changes.** If the page stops rendering a next link and the URL
  scheme changes too, both paths break. That's what `DEBUG = true` is for.

## Privacy

The script runs entirely in your browser. It reads the page URL and finds anchors
already on the page. It makes **no network requests** of its own, sends nothing
anywhere, and stores only a single on/off flag in `localStorage`.

## Testing

The logic runs headlessly against a stubbed DOM — no browser, no userscript
manager, no npm dependencies:

```
node test/auto-next.test.js
```

11 assertions covering:

- following the site's own next-episode link
- the `ep` increment fallback when no link is rendered
- ignoring a next link belonging to a different series
- doing nothing when the toggle is off, or on a non-watch page
- not advancing when you scrub to the end (`seeking`)
- advancing from `timeupdate` when the player never fires `ended`
- not advancing a looping video
- the toggle persisting to `localStorage` and reflecting in the label
- starting switched off when the stored preference says so

## Changelog

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
