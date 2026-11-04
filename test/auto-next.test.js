// Headless regression tests for GoodShort-Auto-Next-Episode.user.js.
//
// Runs the userscript against a stubbed DOM, so the episode-advance logic can
// be checked without a browser, a userscript manager or any npm dependencies.
//
// Usage: node test/auto-next.test.js
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'GoodShort-Auto-Next-Episode.user.js');
const WATCH = 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=3';

// A fake page: stubbed DOM, fake location, and the handles needed to drive it.
function createPage(options = {}) {
    const videos = options.videos || [];
    const links = options.links || [];
    const store = new Map();
    if (options.enabled === false) store.set('goodshort-auto-next-enabled', 'off');

    const timers = [];
    let nextTimer = 1;
    const appended = [];
    const location = { href: options.href || WATCH };

    // Listener registries for the events the script waits for.
    const docHandlers = new Map();
    const winHandlers = new Map();

    function addTo(map, name, fn) {
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(fn);
    }

    function removeFrom(map, name, fn) {
        const list = map.get(name);
        const i = list ? list.indexOf(fn) : -1;
        if (i >= 0) list.splice(i, 1);
    }

    function fireOn(map, name) {
        // Copy first: a one-shot handler removes itself while running.
        [...(map.get(name) || [])].forEach(fn => fn({ type: name }));
    }

    // The player's quality menu: a trigger that toggles a panel of options.
    // Modelled so the "pick the highest rendition" logic is actually exercised.
    const qualityLabels = options.quality || null;
    let activeQuality = options.activeQuality || null;
    let panelOpen = false;
    const selections = [];

    const qualityOptions = (qualityLabels || []).map(label => ({
        tagName: 'BUTTON',
        textContent: label,
        classList: { contains: cls => cls === 'active' && label === activeQuality },
        click() {
            activeQuality = label;
            selections.push(label);
            panelOpen = false;
        },
    }));

    const qualityTrigger = qualityLabels
        ? { tagName: 'BUTTON', click() { panelOpen = !panelOpen; } }
        : null;

    // The episode carousel: one slide per episode, advanced without a reload.
    // That is the whole point of advancing in place on a real page, so the
    // stub has to expose the same shape the script drives.
    // dropQualityOnAdvance models the player loading the new episode at its
    // default rendition, which is what makes "quality is re-applied" testable.
    const swiperConfig = options.swiper || null;
    let activeIndex = swiperConfig ? (swiperConfig.activeIndex || 0) : 0;
    let slideNextCalls = 0;

    const swiper = swiperConfig
        ? {
            slides: new Array(swiperConfig.slides || 0).fill(null),
            get activeIndex() { return activeIndex; },
            slideNext() {
                slideNextCalls++;
                activeIndex += 1;
                if (swiperConfig.dropQualityOnAdvance) {
                    activeQuality = swiperConfig.fallbackQuality || '720p';
                    panelOpen = false;
                }
                // A real player mounts the new episode paused at t=0, at
                // readyState 0, and only starts loading once something calls
                // play(). Modelling that is what catches a black screen.
                if (swiperConfig.resetPlaybackOnAdvance) {
                    videos.forEach(v => {
                        v.paused = true;
                        v.readyState = 0;
                        v.currentTime = 0;
                        v.currentSrc = 'https://cdn.example/episode' + (activeIndex + 1) + '.m3u8';
                    });
                }
            },
        }
        : null;

    // dramafren's scripted player: page-global `var`s and functions. Modelled
    // so the adapter is genuinely exercised, including the window after an
    // advance in which the quality list still describes the OLD episode until
    // the player's fetch completes (clicking then would load stale URLs).
    const dramafrenCfg = options.dramafren || null;

    function makeQualities(ep) {
        return [
            { quality: '720P',  url: 'https://cdn.example/720/tok-ep' + ep },
            { quality: '540P',  url: 'https://cdn.example/540/tok-ep' + ep },
            { quality: '1080P', url: 'https://cdn.example/1080/tok-ep' + ep },
        ];
    }

    let dIndex = dramafrenCfg ? (dramafrenCfg.ep ?? 0) : 0;
    const dTotal = dramafrenCfg ? (dramafrenCfg.total ?? 3) : 0;
    let qualitiesArray = dramafrenCfg ? makeQualities(dIndex) : null;
    // The player starts at its default rendition (720P in this model).
    let hlsUrl = dramafrenCfg
        ? makeQualities(dIndex).find(q => q.quality === (dramafrenCfg.current || '720P')).url
        : null;
    let deferredQualities = null;
    let switchEpisodeCalls = 0;
    let goToNextEpCalls = 0;
    const qualityChanges = [];

    function dSwitch(n) {
        switchEpisodeCalls++;
        dIndex = n;
        location.href = location.href.replace(/ep=\d+/, 'ep=' + n);
        if (dramafrenCfg && dramafrenCfg.deferQualities) {
            deferredQualities = makeQualities(n);
            hlsUrl = null; // stream not yet loaded, nothing matches yet
            return;
        }
        qualitiesArray = makeQualities(n);
        hlsUrl = makeQualities(n)[0].url; // default rendition
    }

    const dramafrenGlobals = dramafrenCfg
        ? {
            get currentEpIdx() { return dIndex; },
            totalEp: dTotal,
            get availableQualities() { return qualitiesArray; },
            videoPlayer: { src: 'blob:dramafren' },
            get hls() { return hlsUrl ? { url: hlsUrl } : null; },
            switchEpisode: dSwitch,
            goToNextEp() {
                goToNextEpCalls++;
                if (dIndex < dTotal - 1) dSwitch(dIndex + 1);
            },
            changeQuality(url) {
                qualityChanges.push(url);
                hlsUrl = url;
            },
        }
        : {};

    const swiperElement = swiper ? { swiper } : null;

    const document = {
        body: { appendChild(el) { appended.push(el); } },
        getElementById(id) {
            return appended.find(el => el.id === id) || null;
        },
        createElement(tag) {
            const handlers = {};
            return {
                tagName: String(tag).toUpperCase(),
                id: '',
                type: '',
                title: '',
                textContent: '',
                style: { cssText: '', background: '' },
                addEventListener(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
                click() { (handlers.click || []).forEach(fn => fn()); },
            };
        },
        querySelectorAll(selector) {
            if (selector === 'video') return videos;
            if (selector === 'a[href]') return links;
            if (selector === 'button.quality-option') return panelOpen ? qualityOptions : [];
            return [];
        },
        querySelector(selector) {
            if (selector === 'button[aria-label="Quality"]') return qualityTrigger;
            if (selector === 'video') return videos[0] || null;
            if (selector === '.watch-swiper') return swiperElement;
            return null;
        },
        addEventListener(name, fn) { addTo(docHandlers, name, fn); },
        removeEventListener(name, fn) { removeFrom(docHandlers, name, fn); },
    };

    const windowStub = {
        addEventListener(name, fn) { addTo(winHandlers, name, fn); },
        removeEventListener(name, fn) { removeFrom(winHandlers, name, fn); },
    };
    // Copy the dramafren page-globals across, keeping getters live.
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(dramafrenGlobals))) {
        Object.defineProperty(windowStub, key, desc);
    }

    const sandbox = {
        document,
        location,
        window: windowStub,
        URL,
        localStorage: {
            getItem: key => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
        },
        MutationObserver: class { observe() {} disconnect() {} },
        console: { log() {} },
        setTimeout: (fn) => { const id = nextTimer++; timers.push({ id, fn }); return id; },
        clearTimeout: (id) => {
            const i = timers.findIndex(t => t.id === id);
            if (i >= 0) timers.splice(i, 1);
        },
    };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), sandbox, { filename: SCRIPT });

    return {
        location,
        store,
        videos,
        toggle: () => document.getElementById('gs-auto-next-toggle'),
        quality: {
            get selected() { return selections.length ? selections[selections.length - 1] : null; },
            get selections() { return selections.slice(); },
            get active() { return activeQuality; },
            get panelOpen() { return panelOpen; },
            get optionsAvailable() { return qualityOptions.length > 0; },
        },
        swiper: {
            get calls() { return slideNextCalls; },
            get activeIndex() { return activeIndex; },
        },
        ...(dramafrenCfg ? {
            dramafren: {
                get switchCalls() { return switchEpisodeCalls; },
                get goToNextEpCalls() { return goToNextEpCalls; },
                get qualityChanges() { return qualityChanges.slice(); },
                get ep() { return dIndex; },
                get hlsUrl() { return hlsUrl; },
                // The player's fetch completing: a brand-new quality array swaps
                // in and the stream loads its default rendition again.
                flushQualities() {
                    if (!deferredQualities) return;
                    qualitiesArray = deferredQualities;
                    hlsUrl = deferredQualities[0].url;
                    deferredQualities = null;
                },
            },
        } : {}),
        // Deliver a document-level gesture or event.
        fireWindow(name) { fireOn(winHandlers, name); },
        // Timers can schedule further timers (the quality retry loop, the
        // settle-after-advance timeout), so drain until quiet, not one round.
        flush(limit = 100) {
            for (let i = 0; i < limit && timers.length; i++) {
                timers.splice(0, timers.length).forEach(t => t.fn());
            }
        },
    };
}

function makeVideo(overrides) {
    const listeners = {};
    return Object.assign({
        paused: true,
        readyState: 0,
        duration: 100,
        currentTime: 0,
        seeking: false,
        loop: false,
        muted: false,
        isConnected: true,
        src: '',
        playCalls: 0,
        addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
        emit(name) { (listeners[name] || []).forEach(fn => fn()); },
        play() {
            this.playCalls++;
            this.paused = false;
            return Promise.resolve();
        },
    }, overrides || {});
}

// --- runner ----------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  pass  ' + name);
    } catch (err) {
        failed++;
        console.log('  FAIL  ' + name);
        console.log('        ' + err.message);
    }
}

function assert(cond, message) {
    if (!cond) throw new Error(message);
}

// --- advancing -------------------------------------------------------------

test("follows the site's own next-episode link when one exists", () => {
    const next = 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=4';
    const video = makeVideo();
    const page = createPage({ videos: [video], links: [{ href: next }, { href: 'https://goodshort.dramafren.org/' }] });

    video.emit('ended');

    assert(page.location.href === next, 'expected the next link, got ' + page.location.href);
});

test('falls back to incrementing ep when no next link is rendered', () => {
    const video = makeVideo();
    const page = createPage({ videos: [video] });

    video.emit('ended');

    assert(
        page.location.href === 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=4',
        'expected ep=4, got ' + page.location.href
    );
});

test('ignores a next link for a different series', () => {
    const video = makeVideo();
    const page = createPage({
        videos: [video],
        links: [{ href: 'https://goodshort.dramafren.org/?page=watch&id=other&ep=4' }],
    });

    video.emit('ended');

    assert(
        page.location.href === 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=4',
        'should have ignored the other series, got ' + page.location.href
    );
});

test('does nothing once auto-next is switched off', () => {
    const video = makeVideo();
    const page = createPage({ videos: [video] });

    page.toggle().click(); // switched off
    video.emit('ended');

    assert(page.location.href === WATCH, 'should not have navigated, got ' + page.location.href);
});

test('does nothing on a page that is not the watch page', () => {
    const video = makeVideo();
    const page = createPage({ videos: [video], href: 'https://goodshort.dramafren.org/browse' });

    video.emit('ended');

    assert(!page.location.href.includes('ep='), 'should not have navigated, got ' + page.location.href);
});

// --- episodes without an ep parameter ---------------------------------------

test('ignores a watch page with no episode number', () => {
    const video = makeVideo();
    const page = createPage({ videos: [video], href: 'https://goodshort.dramafren.org/?page=watch&id=abc' });

    video.emit('ended');

    assert(
        page.location.href === 'https://goodshort.dramafren.org/?page=watch&id=abc',
        'should not navigate without an ep, got ' + page.location.href
    );
});

// --- the end-of-video backup ----------------------------------------------

test('does not skip the episode when the user scrubs to the end', () => {
    const video = makeVideo({ seeking: true, currentTime: 99.9 });
    const page = createPage({ videos: [video] });

    video.emit('timeupdate');

    assert(page.location.href === WATCH, 'a seek should not advance, got ' + page.location.href);
});

test('advances from timeupdate when the player never emits ended', () => {
    const video = makeVideo({ seeking: false, currentTime: 99.9 });
    const page = createPage({ videos: [video] });

    video.emit('timeupdate');

    assert(
        page.location.href === 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=4',
        'expected ep=4, got ' + page.location.href
    );
});

test('does not advance on a looping video', () => {
    const video = makeVideo({ seeking: false, currentTime: 99.9, loop: true });
    const page = createPage({ videos: [video] });

    video.emit('timeupdate');

    assert(page.location.href === WATCH, 'a looping video should not advance');
});

// --- toggle ---------------------------------------------------------------

test('remembers the toggle across reloads', () => {
    const page = createPage({ videos: [makeVideo()] });

    page.toggle().click();
    assert(page.store.get('goodshort-auto-next-enabled') === 'off', 'expected "off" to be stored');

    page.toggle().click();
    assert(page.store.get('goodshort-auto-next-enabled') === 'on', 'expected "on" to be stored');
});

test('reflects the state in the button label', () => {
    const page = createPage({ videos: [makeVideo()] });

    assert(/ON/.test(page.toggle().textContent), 'expected ON, got ' + page.toggle().textContent);

    page.toggle().click();
    assert(/OFF/.test(page.toggle().textContent), 'expected OFF, got ' + page.toggle().textContent);
});

test('starts switched off when the stored preference says so', () => {
    const page = createPage({ videos: [makeVideo()], enabled: false });
    assert(/OFF/.test(page.toggle().textContent), 'expected OFF from stored preference');
});

// --- quality ---------------------------------------------------------------

test('picks the highest rendition when the player starts below it', () => {
    const page = createPage({
        videos: [makeVideo()],
        quality: ['1080p', '720p', '480p'],
        activeQuality: '720p',
    });

    page.flush();

    assert(page.quality.selected === '1080p', 'expected 1080p, got ' + page.quality.selected);
    assert(page.quality.active === '1080p', 'active should now be 1080p');
});

test('leaves the player alone when it is already at maximum', () => {
    const page = createPage({
        videos: [makeVideo()],
        quality: ['1080p', '720p', '480p'],
        activeQuality: '1080p',
    });

    page.flush();

    assert(page.quality.selected === null, 'should not have re-selected, got ' + page.quality.selected);
    assert(page.quality.panelOpen === false, 'panel should have been closed again');
});

test('does nothing when the player has no quality control', () => {
    const page = createPage({ videos: [makeVideo()] });

    page.flush();

    assert(page.quality.selected === null, 'nothing to select');
});

test('still sets quality when auto-next is switched off', () => {
    const page = createPage({
        videos: [makeVideo()],
        enabled: false,
        quality: ['1080p', '720p'],
        activeQuality: '720p',
    });

    page.flush();

    assert(page.quality.selected === '1080p', 'quality is independent of the toggle');
});

test('does not touch quality on a page that is not a watch page', () => {
    const page = createPage({
        videos: [makeVideo()],
        href: 'https://goodshort.dramafren.org/browse',
        quality: ['1080p', '720p'],
        activeQuality: '720p',
    });

    page.flush();

    assert(page.quality.selected === null, 'should not have opened the panel');
});

// --- advancing in place ----------------------------------------------------

test('advances through the episode swiper without reloading the page', () => {
    const video = makeVideo();
    const page = createPage({ videos: [video], swiper: { slides: 10, activeIndex: 2 } });

    video.emit('ended');

    assert(page.swiper.calls === 1, 'expected one slideNext, got ' + page.swiper.calls);
    assert(page.swiper.activeIndex === 3, 'expected slide 3, got ' + page.swiper.activeIndex);
    assert(
        page.location.href === WATCH,
        'a same-page advance must not touch location.href, got ' + page.location.href
    );
});

test('does not advance past the last slide', () => {
    const video = makeVideo();
    const href = 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=36';
    const page = createPage({
        videos: [video],
        href,
        swiper: { slides: 36, activeIndex: 35 },
    });

    video.emit('ended');

    assert(page.swiper.calls === 0, 'should not have stepped past the end');
    assert(page.location.href === href, 'should not have navigated, got ' + page.location.href);
    assert(/Last episode/.test(page.toggle().textContent), 'expected a last-episode message, got ' + page.toggle().textContent);
});

test('re-applies max quality after the new episode loads', () => {
    const video = makeVideo();
    const page = createPage({
        videos: [video],
        href: 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=5',
        quality: ['1080p', '720p', '480p'],
        activeQuality: '720p',
        swiper: { slides: 36, activeIndex: 4, dropQualityOnAdvance: true },
    });

    page.flush();
    assert(page.quality.selected === '1080p', 'expected 1080p before advancing');

    video.emit('ended');
    page.flush();

    assert(page.quality.selections.length === 2, 'expected quality to be re-selected, got ' + page.quality.selections.length);
    assert(page.quality.selected === '1080p', 'the new episode should be back at 1080p, got ' + page.quality.selected);
    assert(page.location.href === 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=5', 'should still be a same-page advance');
});

// --- playback --------------------------------------------------------------

test('does not undo a pause when the page mutates again', () => {
    const video = makeVideo({ readyState: 2, src: 'https://cdn.example/720.m3u8' });
    const page = createPage({ videos: [video] });

    page.flush();
    assert(video.playCalls === 1, 'expected the first attach to autoplay once, got ' + video.playCalls);

    video.paused = true; // the user hits pause
    page.fireWindow('pageshow'); // and the page churns, as it constantly does
    page.flush();

    assert(video.playCalls === 1, 'a pause must survive another attach pass, but play ran ' + video.playCalls + ' times');
    assert(video.paused === true, 'the video should have stayed paused');
});

test('autoplays again once the episode actually changes', () => {
    const video = makeVideo({ readyState: 2, src: 'https://cdn.example/720.m3u8' });
    const page = createPage({ videos: [video] });

    page.flush();
    assert(video.playCalls === 1, 'expected one autoplay');

    video.paused = true;
    video.src = 'https://cdn.example/1080.m3u8'; // next episode: different media
    page.fireWindow('pageshow');
    page.flush();

    assert(video.playCalls === 2, 'new media should get its own autoplay, got ' + video.playCalls);
});

test('starts the new episode even though it mounts paused and unloaded', () => {
    const video = makeVideo({ readyState: 2, src: 'https://cdn.example/episode5.m3u8' });
    const page = createPage({
        videos: [video],
        href: 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=5',
        swiper: { slides: 36, activeIndex: 4, resetPlaybackOnAdvance: true },
    });

    page.flush();
    assert(video.playCalls === 1, 'the first episode should autoplay, got ' + video.playCalls);

    video.emit('ended');
    assert(video.paused === true, 'the new episode mounts paused');
    assert(video.readyState === 0, 'the new episode mounts unloaded');

    page.flush();

    assert(video.playCalls === 2, 'expected exactly one nudge to start it, got ' + video.playCalls);
    assert(video.paused === false, 'the new episode should be playing, not black');
});

test('starts playback on a video that has not loaded yet', () => {
    const video = makeVideo({ readyState: 0, src: 'https://cdn.example/episode1.m3u8' });
    const page = createPage({ videos: [video] });

    page.flush();

    assert(video.playCalls === 1, 'readyState 0 must not block the play attempt, got ' + video.playCalls);
});

// --- dramafren player (SPA) ---------------------------------------------------

const DRAMA = 'https://goodshort.dramafren.org/?page=watch&id=abc&ep=3';

test('advances dramafren in place via its own switchEpisode, no reload', () => {
    const video = makeVideo();
    const page = createPage({
        videos: [video],
        href: DRAMA,
        dramafren: { ep: 3, total: 51 },
    });

    video.emit('ended');

    assert(page.dramafren.goToNextEpCalls === 1, 'expected one goToNextEp, got ' + page.dramafren.goToNextEpCalls);
    assert(page.dramafren.switchCalls === 1, 'expected the SPA switch, got ' + page.dramafren.switchCalls);
    assert(page.dramafren.ep === 4, 'expected episode 4, got ' + page.dramafren.ep);
    assert(page.location.href === DRAMA.replace('ep=3', 'ep=4'), 'pushState should update the url, got ' + page.location.href);
});

test('applies max quality on dramafren initial load', () => {
    const video = makeVideo();
    const page = createPage({
        videos: [video],
        href: DRAMA,
        dramafren: { ep: 3, total: 51 },
    });

    page.flush();

    assert(
        page.dramafren.qualityChanges[page.dramafren.qualityChanges.length - 1] === 'https://cdn.example/1080/tok-ep3',
        'expected a switch to 1080P, got ' + JSON.stringify(page.dramafren.qualityChanges)
    );
    assert(page.dramafren.hlsUrl === 'https://cdn.example/1080/tok-ep3', 'expected hls at 1080P');
});

test('does nothing on dramafren when already at max quality', () => {
    const video = makeVideo();
    const page = createPage({
        videos: [video],
        href: DRAMA,
        dramafren: { ep: 3, total: 51, current: '1080P' },
    });

    page.flush();

    assert(page.dramafren.qualityChanges.length === 0, 'already at max, no change expected, got ' + JSON.stringify(page.dramafren.qualityChanges));
});

test('waits for fresh qualities after a dramafren advance before re-applying', () => {
    const video = makeVideo();
    const page = createPage({
        videos: [video],
        href: DRAMA,
        dramafren: { ep: 3, total: 51, deferQualities: true },
    });

    page.flush();
    const initialChanges = page.dramafren.qualityChanges.length;
    assert(page.dramafren.qualityChanges[initialChanges - 1] === 'https://cdn.example/1080/tok-ep3', 'initial pass should pick 1080P');

    video.emit('ended');
    // One round of timers: the re-apply passes see the OLD list and must no-op.
    page.flush(1);

    // The player's fetch hasn't completed in the stub yet: the list still
    // describes episode 3, so no quality change may happen.
    assert(
        page.dramafren.qualityChanges.length === initialChanges,
        'must not act on the stale quality list, got ' + JSON.stringify(page.dramafren.qualityChanges)
    );

    // The fetch completes: the fresh array swaps in, the player loads its
    // default rendition, and only now may max quality be applied.
    page.dramafren.flushQualities();
    page.flush();

    assert(
        page.dramafren.qualityChanges[page.dramafren.qualityChanges.length - 1] === 'https://cdn.example/1080/tok-ep4',
        'expected a switch to the NEW episode 1080P, got ' + JSON.stringify(page.dramafren.qualityChanges)
    );
});

test('stops at the last dramafren episode instead of advancing', () => {
    const video = makeVideo();
    const page = createPage({
        videos: [video],
        href: DRAMA.replace('ep=3', 'ep=50'),
        dramafren: { ep: 50, total: 51 },
    });

    video.emit('ended');

    assert(page.dramafren.goToNextEpCalls === 0, 'goToNextEp must not run at the last episode');
    assert(page.dramafren.switchCalls === 0, 'switchEpisode must not run at the last episode');
    assert(page.location.href === DRAMA.replace('ep=3', 'ep=50'), 'must not navigate, got ' + page.location.href);
    assert(/Last episode/.test(page.toggle().textContent), 'expected a last-episode message, got ' + page.toggle().textContent);
});

// --- report ----------------------------------------------------------------

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
