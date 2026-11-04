// ==UserScript==
// @name         GoodShort Auto Next Episode
// @namespace    https://github.com/poorloading/goodshort-auto-next-episode
// @version      1.5.1
// @description  Automatically plays the next episode when the current video ends.
// @author       poorloading
// @license      MIT
// @homepageURL  https://github.com/poorloading/goodshort-auto-next-episode
// @supportURL   https://github.com/poorloading/goodshort-auto-next-episode/issues
// @updateURL    https://raw.githubusercontent.com/poorloading/goodshort-auto-next-episode/main/GoodShort-Auto-Next-Episode.user.js
// @downloadURL  https://raw.githubusercontent.com/poorloading/goodshort-auto-next-episode/main/GoodShort-Auto-Next-Episode.user.js
// @match        https://*.dramafren.org/*
// @match        http://*.dramafren.org/*
// @match        https://*.shorttw.live/*
// @match        http://*.shorttw.live/*
// @match        https://*.reelfren.net/*
// @match        http://*.reelfren.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';

  const DEBUG = false;
  const APPLY_DELAY_MS = 150;   // debounce for DOM churn
  const END_THRESHOLD_S = 0.35; // backup trigger: how near the end counts as finished
  const MESSAGE_MS = 4000;      // how long a status message stays before reverting
  const MAX_QUALITY = true;     // pick the highest rendition the player offers
  const QUALITY_RETRY_MS = 400; // how often to look for the quality control
  const QUALITY_MAX_TRIES = 15; // ~6s of looking, then give up quietly
  const KEY = 'goodshort-auto-next-enabled';
  const FS_KEY = 'goodshort-auto-fullscreen-enabled';

  // The player's own quality menu. Two elements, driven like a user would.
  const QUALITY_TRIGGER = 'button[aria-label="Quality"]';
  const QUALITY_OPTION = 'button.quality-option';
  const PLAYER_SECTION = 'section.phone-player';
  const SWIPER = '.watch-swiper';
  const FS_BUTTON = 'button[aria-label="Full Screen"]';

  const log = (...args) => { if (DEBUG) console.log('[auto-next]', ...args); };

  // localStorage throws in some privacy modes, so never let it break the script.
  function readEnabled() {
    try {
      return localStorage.getItem(KEY) !== 'off';
    } catch (_) {
      return true;
    }
  }

  function writeEnabled(value) {
    try {
      localStorage.setItem(KEY, value ? 'on' : 'off');
    } catch (_) {
      /* storage unavailable: the toggle still works for this page view */
    }
  }

  function readFullscreen() {
    try {
      return localStorage.getItem(FS_KEY) !== 'off';
    } catch (_) {
      return true;
    }
  }

  function writeFullscreen(value) {
    try {
      localStorage.setItem(FS_KEY, value ? 'on' : 'off');
    } catch (_) {
      /* as above */
    }
  }

  let enabled = readEnabled();
  let fullscreenWanted = readFullscreen();
  const attachedVideos = new WeakSet();
  let nextButton;
  let fsButton;
  let navigating = false;
  let attachTimer = null;
  let messageTimer = null;
  let qualityTries = 0;
  let qualitySettled = false;
  let qualityPanelOpened = false;
  let fsArmed = false;
  let fsEnter = null;

  // --- toggles -------------------------------------------------------------

  const BUTTON_CSS = 'position:fixed;z-index:2147483647;right:14px;padding:9px 12px;border:0;border-radius:8px;background:#191919;color:#fff;font:13px/1.2 sans-serif;box-shadow:0 2px 12px #0006;cursor:pointer';

  function makeButton(id, title, bottom) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.title = title;
    button.style.cssText = BUTTON_CSS + ';bottom:' + bottom + 'px';
    document.body.appendChild(button);
    return button;
  }

  function makeToggles() {
    if (document.getElementById('gs-auto-next-toggle')) return;
    if (!document.body) return; // document-idle, but be defensive

    nextButton = makeButton('gs-auto-next-toggle', 'Toggle automatic next episode', 14);
    nextButton.addEventListener('click', () => {
      enabled = !enabled;
      writeEnabled(enabled);
      updateToggles();
      log('auto-next ' + (enabled ? 'enabled' : 'disabled'));
    });

    fsButton = makeButton('gs-auto-fs-toggle', 'Toggle automatic fullscreen', 58);
    fsButton.addEventListener('click', () => {
      fullscreenWanted = !fullscreenWanted;
      writeFullscreen(fullscreenWanted);
      updateToggles();
      log('auto-fullscreen ' + (fullscreenWanted ? 'enabled' : 'disabled'));
      // Turning it on while already watching should take effect straight away,
      // which only a gesture can do.
      if (fullscreenWanted) armFullscreen();
    });

    updateToggles();
  }

  function paint(button, on, label) {
    if (!button) return;
    button.textContent = label + ': ' + (on ? 'ON' : 'OFF');
    button.style.background = on ? '#176b45' : '#555';
  }

  function updateToggles(message) {
    clearTimeout(messageTimer);

    if (nextButton) {
      if (message) {
        nextButton.textContent = message;
        nextButton.style.background = '#8a6d1f';
        messageTimer = setTimeout(() => updateToggles(), MESSAGE_MS);
      } else {
        paint(nextButton, enabled, 'Auto-next');
      }
    }
    paint(fsButton, fullscreenWanted, 'Auto-fullscreen');
  }

  // Status messages belong on the auto-next button; nothing else uses them.
  function updateButton(message) {
    updateToggles(message);
  }

  // --- quality -------------------------------------------------------------

  // The player has no API for this and each rendition has its own signed
  // auth_key, so the URL can't simply be rewritten. The site's own panel is the
  // only reliable route, and it's what a user would click anyway.
  function qualityRank(label) {
    const match = /(\d{3,4})/.exec(String(label || ''));
    return match ? Number.parseInt(match[1], 10) : -1;
  }

  function closeQualityPanel() {
    const trigger = document.querySelector(QUALITY_TRIGGER);
    if (trigger) trigger.click();
  }

  function retryQuality() {
    if (qualitySettled || qualityTries >= QUALITY_MAX_TRIES) return;
    qualityTries++;
    setTimeout(applyMaxQuality, QUALITY_RETRY_MS);
  }

  function applyMaxQuality() {
    if (!MAX_QUALITY || qualitySettled) return;

    const options = Array.from(document.querySelectorAll(QUALITY_OPTION));

    if (!options.length) {
      // Only click the trigger once: it toggles the panel, so retrying the
      // click would flicker it open and shut.
      if (!qualityPanelOpened) {
        if (!document.querySelector('video')) {
          retryQuality();
          return;
        }
        const trigger = document.querySelector(QUALITY_TRIGGER);
        if (!trigger) {
          // Player has no quality control; nothing to do here.
          retryQuality();
          return;
        }
        log('opening quality panel');
        trigger.click();
        qualityPanelOpened = true;
      }
      retryQuality();
      return;
    }

    const best = options.reduce(
      (a, b) => (qualityRank(b.textContent) > qualityRank(a.textContent) ? b : a)
    );
    const active = options.find((option) => option.classList.contains('active'));

    if (active && qualityRank(active.textContent) >= qualityRank(best.textContent)) {
      log('quality already at max (' + active.textContent.trim() + ')');
      if (qualityPanelOpened) closeQualityPanel();
      qualitySettled = true;
      return;
    }

    log('quality ' + (active ? active.textContent.trim() : '?') + ' -> ' + best.textContent.trim());
    best.click();
    qualitySettled = true;
    qualityPanelOpened = false; // the player closes the panel on selection
  }

  // --- fullscreen ----------------------------------------------------------

  // There is one <section class="phone-player"> per episode — 36 of them on a
  // 36-episode series — and only the active one holds a <video>. Fullscreening
  // the first match therefore shows an empty player: a black screen. Start from
  // the video and walk up to the player that actually owns it.
  function fullscreenTarget() {
    const video = document.querySelector('video');
    const owner = video && video.closest ? video.closest(PLAYER_SECTION) : null;
    if (owner) return owner;

    const active = document.querySelector('.swiper-slide-active ' + PLAYER_SECTION);
    if (active) return active;

    return document.querySelector(PLAYER_SECTION) || document.documentElement;
  }

  // Browsers only grant fullscreen on a fresh user gesture, so this can never
  // be silent: it arms a one-shot listener and enters fullscreen on the next
  // click, key press or tap.
  function armFullscreen() {
    if (!fullscreenWanted || document.fullscreenElement || fsArmed) return;
    // The toggle is visible on every page of a mirror; only watch pages have a
    // player worth going fullscreen for.
    if (!isWatchPage(new URL(location.href))) return;
    fsArmed = true;

    const enter = (event) => {
      // If the gesture was on the site's own fullscreen button, let the site do
      // it. Handling it here too would enter and immediately exit, since its
      // click handler toggles based on the same state.
      const target = event && event.target;
      if (target && target.closest && target.closest(FS_BUTTON)) {
        disarmFullscreen();
        return;
      }

      disarmFullscreen();

      if (!fullscreenWanted || document.fullscreenElement) return;
      const player = fullscreenTarget();
      if (!player.requestFullscreen) return;

      const attempt = player.requestFullscreen();
      if (attempt && attempt.catch) {
        attempt.catch((error) => log('fullscreen refused:', error.name));
      }
      log('entering fullscreen');
    };

    fsEnter = enter;
    document.addEventListener('pointerdown', enter, true);
    document.addEventListener('keydown', enter, true);
    document.addEventListener('touchstart', enter, true);
    log('auto-fullscreen armed');
  }

  function disarmFullscreen() {
    fsArmed = false;
    if (!fsEnter) return;
    document.removeEventListener('pointerdown', fsEnter, true);
    document.removeEventListener('keydown', fsEnter, true);
    document.removeEventListener('touchstart', fsEnter, true);
    fsEnter = null;
  }

  // --- advancing in place --------------------------------------------------

  // Every episode is a slide in one swiper, so stepping it moves to the next
  // episode without a page load. That matters beyond speed: a navigation always
  // drops you out of fullscreen, and no script can put you back without another
  // gesture.
  function advanceInPlace() {
    const element = document.querySelector(SWIPER);
    const swiper = element && element.swiper;
    if (!swiper || typeof swiper.slideNext !== 'function') return false;

    const total = swiper.slides ? swiper.slides.length : 0;
    if (total && swiper.activeIndex >= total - 1) {
      couldNotAdvance();
      return true; // handled: don't guess a URL past the end
    }

    navigating = true;
    updateButton('Episode ended — loading next…');

    // A new episode means a new <video>, back at the player's default
    // rendition, so quality has to be re-applied.
    qualitySettled = false;
    qualityTries = 0;
    qualityPanelOpened = false;

    log('advancing in place to slide ' + (swiper.activeIndex + 1));
    swiper.slideNext();
    ensurePlayingAfterAdvance();

    // The slide and its player take a moment to swap in.
    setTimeout(() => {
      navigating = false;
      applyMaxQuality();
      armFullscreen();
    }, 1200);

    return true;
  }

  function couldNotAdvance() {
    updateButton('Last episode — nothing to advance to');
    log('no next episode available');
  }

  // --- watch pages ---------------------------------------------------------

  // Two URL shapes are in use across the mirrors:
  //   dramafren.org / shorttw.live  /?page=watch&id=<id>&ep=<n>
  //   reelfren.net                  /watch/<type>/<id>-<slug>?ep=<n>&lang=<cc>
  function isWatchPage(url) {
    if (url.searchParams.get('page') === 'watch') return true;
    return /^\/watch\//.test(url.pathname);
  }

  // Episode number from ?ep=, or null when it's missing or not a whole number.
  function episodeOf(url) {
    const raw = url.searchParams.get('ep');
    if (raw === null || !/^\d+$/.test(raw)) return null;
    return Number.parseInt(raw, 10);
  }

  // Same series? Compared on path plus the id param, so it holds for both
  // shapes: on reelfren the series is the path, on dramafren it's ?id=.
  function sameSeries(a, b) {
    if (a.pathname !== b.pathname) return false;
    const idA = a.searchParams.get('id');
    const idB = b.searchParams.get('id');
    if (idA || idB) return idA === idB;
    return true;
  }

  // The site's own next-episode link, if the page rendered one.
  function findNextLink(url, episode) {
    for (const anchor of document.querySelectorAll('a[href]')) {
      try {
        const candidate = new URL(anchor.href, location.href);
        if (!isWatchPage(candidate)) continue;
        if (!sameSeries(candidate, url)) continue;
        if (episodeOf(candidate) !== episode + 1) continue;
        return anchor.href;
      } catch (_) {
        /* malformed href, skip it */
      }
    }
    return null;
  }

  function nextEpisode() {
    if (!enabled || navigating) return;

    const url = new URL(location.href);
    if (!isWatchPage(url)) return;

    const episode = episodeOf(url);
    if (episode === null) return;

    // In place first: same page, so fullscreen survives. Only fall back to a
    // navigation when the page has no swiper to drive.
    if (advanceInPlace()) return;

    // Prefer the page's own link, which knows about numbering quirks and any
    // per-episode path changes. Otherwise bump ?ep= in place: everything else
    // in the URL is left alone, so ?lang= and the path survive untouched.
    let target = findNextLink(url, episode);
    if (!target) {
      url.searchParams.set('ep', String(episode + 1));
      target = url.href;
    }

    navigating = true;
    updateButton('Episode ended — loading next…');
    log('navigating to', target);
    location.href = target;
  }

  // --- playback ------------------------------------------------------------

  let unmuteArmed = false;

  // Autoplay with sound is blocked until the user interacts. Playback starts
  // muted so it isn't stalled; this restores the sound on the first gesture.
  function unmuteOnNextGesture(video) {
    if (unmuteArmed) return;
    unmuteArmed = true;

    const restore = () => {
      document.removeEventListener('pointerdown', restore, true);
      document.removeEventListener('keydown', restore, true);
      document.removeEventListener('touchstart', restore, true);
      if (!enabled || !video.isConnected) return;
      if (video.muted) {
        video.muted = false;
        log('unmuted after user gesture');
      }
    };

    document.addEventListener('pointerdown', restore, true);
    document.addEventListener('keydown', restore, true);
    document.addEventListener('touchstart', restore, true);
  }

  // Auto-play is attempted once per piece of media, not on every attach pass.
  // Without this, the page's constant DOM churn re-played the video a moment
  // after the user paused it.
  const playAttempts = new WeakMap();

  // How long after an advance to keep nudging playback along. The new episode
  // mounts paused, and the quality re-apply swaps its stream — which resets it
  // to paused at 0 again. A loaded, paused video paints nothing, so the player
  // just looks black until something calls play().
  const PLAY_RETRY_MS = [400, 1000, 2000, 3200];

  function startPlayback(video) {
    if (!enabled || !video.paused) return;

    const attempt = video.play();
    if (!attempt || typeof attempt.catch !== 'function') return;

    attempt.catch(() => {
      if (!enabled || !video.paused) return;
      video.muted = true;
      video.play()
        .then(() => unmuteOnNextGesture(video))
        .catch(() => updateButton('Press Play to start (browser blocked autoplay)'));
    });
  }

  function tryPlay(video) {
    if (!enabled || !video.paused) return;

    // Not readyState: a freshly mounted episode sits at readyState 0 until
    // something calls play(), so gating on readiness deadlocked here. Having a
    // source is the only thing that actually matters.
    const media = video.currentSrc || video.src || '';
    if (!media) return;
    if (playAttempts.get(video) === media) return; // already had its go
    playAttempts.set(video, media);

    startPlayback(video);
  }

  // Belt and braces for the gap between the slide changing and the new stream
  // being playable: neither the DOM observer nor the media events reliably fire
  // in between, and the quality swap resets playback after they would have.
  function ensurePlayingAfterAdvance() {
    for (const delay of PLAY_RETRY_MS) {
      setTimeout(() => {
        if (!enabled) return;
        const video = document.querySelector('video');
        if (!video || !video.paused) return;
        log('nudging playback after advance (' + delay + 'ms)');
        startPlayback(video);
      }, delay);
    }
  }

  function attachVideo() {
    makeToggles();

    const page = new URL(location.href);
    if (!isWatchPage(page)) {
      // Not a watch page. Logged rather than swallowed: on a new mirror this is
      // the first thing to check when the script looks like it does nothing.
      log('not a watch page on ' + page.hostname + ' (path=' + page.pathname +
          ', page=' + page.searchParams.get('page') + ')');
      return;
    }

    // Independent of the auto-next toggle: turning off auto-advance shouldn't
    // drop you back to a lower rendition.
    applyMaxQuality();

    // Fullscreen can't be granted without a gesture, so arm it and wait.
    armFullscreen();

    if (!enabled) return;

    for (const video of document.querySelectorAll('video')) {
      if (attachedVideos.has(video)) {
        tryPlay(video);
        continue;
      }

      attachedVideos.add(video);
      video.addEventListener('ended', nextEpisode);
      video.addEventListener('loadedmetadata', () => tryPlay(video));
      video.addEventListener('loadeddata', () => tryPlay(video));
      video.addEventListener('canplay', () => tryPlay(video));

      // Backup for players that never emit `ended`. A seek is ignored, so
      // scrubbing to the last moment doesn't skip the episode.
      video.addEventListener('timeupdate', () => {
        if (!enabled || navigating || video.seeking || video.loop) return;
        if (!Number.isFinite(video.duration) || video.duration <= 0) return;
        if (video.currentTime >= video.duration - END_THRESHOLD_S) nextEpisode();
      });

      tryPlay(video);
    }
  }

  function scheduleAttach() {
    clearTimeout(attachTimer);
    attachTimer = setTimeout(attachVideo, APPLY_DELAY_MS);
  }

  // --- init ----------------------------------------------------------------

  makeToggles();
  attachVideo();

  // Debounced: this page mutates constantly, and a full pass per mutation is
  // what made v1.0.0 expensive.
  new MutationObserver(scheduleAttach).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener('pageshow', () => {
    navigating = false;
    scheduleAttach();
  });

  window.addEventListener('popstate', () => {
    navigating = false;
    scheduleAttach();
  });

  log('v1.5.1 ready on ' + location.hostname);
})();
