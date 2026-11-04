// ==UserScript==
// @name         GoodShort Auto Next Episode
// @namespace    https://github.com/poorloading/goodshort-auto-next-episode
// @version      1.8.0
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

  // The player's own quality menu. Two elements, driven like a user would.
  const QUALITY_TRIGGER = 'button[aria-label="Quality"]';
  const QUALITY_OPTION = 'button.quality-option';
  const SWIPER = '.watch-swiper';

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

  let enabled = readEnabled();
  const attachedVideos = new WeakSet();
  let status;
  let navigating = false;
  let attachTimer = null;
  let messageTimer = null;
  let qualityTries = 0;
  let qualitySettled = false;
  let qualityPanelOpened = false;

  // --- toggle --------------------------------------------------------------

  function makeToggle() {
    if (document.getElementById('gs-auto-next-toggle')) return;
    if (!document.body) return; // document-idle, but be defensive

    const button = document.createElement('button');
    button.id = 'gs-auto-next-toggle';
    button.type = 'button';
    button.title = 'Toggle automatic next episode';
    button.style.cssText = 'position:fixed;z-index:2147483647;right:14px;bottom:14px;padding:9px 12px;border:0;border-radius:8px;background:#191919;color:#fff;font:13px/1.2 sans-serif;box-shadow:0 2px 12px #0006;cursor:pointer';
    button.addEventListener('click', () => {
      enabled = !enabled;
      writeEnabled(enabled);
      updateButton();
      log('auto-next ' + (enabled ? 'enabled' : 'disabled'));
    });

    document.body.appendChild(button);
    status = button;
    updateButton();
  }

  function updateButton(message) {
    if (!status) return;

    clearTimeout(messageTimer);
    status.textContent = message || 'Auto-next: ' + (enabled ? 'ON' : 'OFF');
    status.style.background = message ? '#8a6d1f' : (enabled ? '#176b45' : '#555');

    // A transient status shouldn't sit there forever.
    if (message) {
      messageTimer = setTimeout(() => updateButton(), MESSAGE_MS);
    }
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
    // dramafren's scripted player route, or the generic panel route when
    // that markup isn't present.
    if (applyMaxQualityViaPlayer()) return;
    applyMaxQualityPanel();
  }

  function applyMaxQualityPanel() {
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

  // --- dramafren.org player (SPA watch page) ---------------------------------
  //
  // The GoodShort player on dramafren is fully scripted rather than a swiper:
  //   switchEpisode(n) fetches the next episode's stream, swaps it into the
  //   same <video> and pushStates the new ?ep= URL — no reload at all.
  //   availableQualities holds the renditions of the CURRENT episode
  //   ({quality, url} with per-quality signed URLs), and window.hls is the
  //   live Hls instance whose .url is the rendition actually playing.
  //   goToNextEp() is the site's own bounds-checked "next episode" action.
  //
  // All of it is read lazily through window on every pass: the functions only
  // exist once the player's inline script has run, and the dramafren markup
  // must never leak into other mirrors (they keep the panel-clicking route).

  // Array identity of availableQualities as it was when the last in-place
  // advance was fired. Until the player's fetch swaps in a fresh array, the
  // list still describes the OLD episode and must not be acted on.
  let lastAdvanceQualities = null;
  let waitingForFreshQualities = false;

  function playerApi() {
    if (typeof window !== 'object' || !window) return null;
    if (typeof window.switchEpisode !== 'function' || typeof window.goToNextEp !== 'function') return null;
    if (typeof window.currentEpIdx !== 'number' || typeof window.totalEp !== 'number') return null;
    return window;
  }

  function readQualityList() {
    const qs = window.availableQualities;
    if (!Array.isArray(qs) || qs.length === 0) return null;
    return qs.every(q => q && q.quality && q.url) ? qs : null;
  }

  function bestQualityOf(list) {
    let best = null;
    for (const q of list) {
      if (!best || qualityRank(q.quality) > qualityRank(best.quality)) best = q;
    }
    return best;
  }

  // Returns true when this route took over (settled, applied or gave up), so
  // the generic panel-clicking route stays out of the way.
  function applyMaxQualityViaPlayer() {
    if (!playerApi()) return false;
    if (qualitySettled) return true;

    const qs = readQualityList();
    if (waitingForFreshQualities) {
      if (!qs || qs === lastAdvanceQualities) {
        retryQuality();
        return true;
      }
      waitingForFreshQualities = false;
    }
    if (!qs) {
      retryQuality();
      return true;
    }

    const hls = window.hls;
    const player = window.videoPlayer;
    const currentUrl = (hls && hls.url) || (player && player.src) || null;
    const best = bestQualityOf(qs);
    const currentEntry = currentUrl ? qs.find(q => q.url === currentUrl) : null;

    if (currentEntry && qualityRank(currentEntry.quality) >= qualityRank(best.quality)) {
      log('quality already at max (' + currentEntry.quality + ')');
      qualitySettled = true;
      return true;
    }

    if (typeof window.changeQuality !== 'function') {
      retryQuality();
      return true;
    }

    log('quality ' + (currentEntry ? currentEntry.quality : '?') + ' -> ' + best.quality);
    window.changeQuality(best.url);
    qualitySettled = true;
    return true;
  }

  function advanceInPlaceDramafren() {
    const w = playerApi();
    if (!w) return false;

    if (w.currentEpIdx >= w.totalEp - 1) {
      couldNotAdvance();
      return true; // handled: don't guess a URL past the end
    }

    navigating = true;
    updateButton('Episode ended — loading next…');

    // The next episode arrives at the player's default rendition; quality has
    // to be re-applied once the fresh list comes in.
    qualitySettled = false;
    qualityTries = 0;
    qualityPanelOpened = false;
    lastAdvanceQualities = window.availableQualities || null;
    waitingForFreshQualities = true;

    log('advancing in place via switchEpisode (' + w.currentEpIdx + ' -> ' + (w.currentEpIdx + 1) + ')');
    w.goToNextEp();
    ensurePlayingAfterAdvance();

    setTimeout(() => {
      navigating = false;
      applyMaxQuality();
    }, 1200);

    return true;
  }

  // --- advancing in place --------------------------------------------------

  // Every episode is either a slide in one swiper (reelfren-style markup) or
  // an entry in dramafren's own scripted episode list. Either way, stepping it
  // moves to the next episode without a reload: faster, and whatever player
  // state you set up yourself survives.
  function advanceInPlace() {
    const element = document.querySelector(SWIPER);
    const swiper = element && element.swiper;

    if (!swiper || typeof swiper.slideNext !== 'function') {
      return advanceInPlaceDramafren();
    }

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
    }, 1200);

    return true;
  }

  function couldNotAdvance() {
    updateButton('Last episode — nothing to advance to');
    log('no next episode available');
  }

  // --- watch pages ---------------------------------------------------------

  // Watch pages look like /?page=watch&id=<id>&ep=<n> on both mirrors.
  function isWatchPage(url) {
    return url.searchParams.get('page') === 'watch';
  }

  // Episode number from ?ep=, or null when it's missing or not a whole number.
  function episodeOf(url) {
    const raw = url.searchParams.get('ep');
    if (raw === null || !/^\d+$/.test(raw)) return null;
    return Number.parseInt(raw, 10);
  }

  // Same series? The path is the same for every watch page on both mirrors;
  // the series is identified by ?id=. The path comparison is a harmless extra
  // guard and would also catch a different series that reuses an id across
  // paths.
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

    // In place first: same page, so whatever the site's own player is doing
    // (including fullscreen you set yourself) is left alone. Only fall back to
    // a navigation when the page has no swiper to drive.
    if (advanceInPlace()) return;

    // Prefer the page's own link, which knows about numbering quirks and any
    // per-episode path changes. Otherwise bump ?ep= in place: everything else
    // in the URL is left alone, including ?id= and the path.
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
    makeToggle();

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

  makeToggle();
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

  log('v1.8.0 ready on ' + location.hostname);
})();
