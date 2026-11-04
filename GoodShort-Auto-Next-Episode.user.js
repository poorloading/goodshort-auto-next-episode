// ==UserScript==
// @name         GoodShort Auto Next Episode
// @namespace    https://github.com/poorloading/goodshort-auto-next-episode
// @version      1.2.0
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
  const KEY = 'goodshort-auto-next-enabled';

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

  // --- toggle button -------------------------------------------------------

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
      log('auto-next', enabled ? 'enabled' : 'disabled');
    });

    document.body.appendChild(button);
    status = button;
    updateButton();
  }

  function updateButton(message) {
    if (!status) return;

    clearTimeout(messageTimer);
    status.textContent = message || `Auto-next: ${enabled ? 'ON' : 'OFF'} (click to toggle)`;
    status.style.background = enabled ? '#176b45' : '#555';

    // A transient status shouldn't sit there forever.
    if (message) {
      messageTimer = setTimeout(() => updateButton(), MESSAGE_MS);
    }
  }

  // --- next episode --------------------------------------------------------

  // The site's own next-episode link, if the page rendered one.
  function findNextLink(url, episode) {
    for (const anchor of document.querySelectorAll('a[href]')) {
      try {
        const candidate = new URL(anchor.href, location.href);
        if (candidate.searchParams.get('page') !== 'watch') continue;
        if (candidate.searchParams.get('id') !== url.searchParams.get('id')) continue;
        if (Number.parseInt(candidate.searchParams.get('ep'), 10) !== episode + 1) continue;
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
    if (url.searchParams.get('page') !== 'watch') return;

    // Episodes are numbered from zero on this site.
    const episode = Number.parseInt(url.searchParams.get('ep'), 10);
    if (!Number.isInteger(episode) || episode < 0) return;

    let target = findNextLink(url, episode);
    if (!target) {
      // Fallback for players that don't render a next link on the watch page.
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

  function tryPlay(video) {
    if (!enabled || !video.paused || video.readyState < 2) return;

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

  function attachVideo() {
    makeToggle();
    if (!enabled) return;

    const page = new URL(location.href).searchParams.get('page');
    if (page !== 'watch') {
      // Not a watch page. Logged rather than swallowed: on a new mirror this is
      // the first thing to check when the script looks like it does nothing.
      log('not a watch page (page=' + page + ') on ' + location.hostname);
      return;
    }

    for (const video of document.querySelectorAll('video')) {
      if (attachedVideos.has(video)) {
        tryPlay(video);
        continue;
      }

      attachedVideos.add(video);
      video.addEventListener('ended', nextEpisode);
      video.addEventListener('loadedmetadata', () => tryPlay(video));
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

  log('v1.2.0 ready on ' + location.hostname);
})();
