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

    const document = {
        body: { appendChild(el) { appended.push(el); } },
        documentElement: {},
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
            return [];
        },
        addEventListener() {},
        removeEventListener() {},
    };

    const sandbox = {
        document,
        location,
        window: { addEventListener() {} },
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
        flush() { timers.splice(0, timers.length).forEach(t => t.fn()); },
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
        addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
        emit(name) { (listeners[name] || []).forEach(fn => fn()); },
        play() { this.paused = false; return Promise.resolve(); },
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

// --- reelfren.net (path-based watch URLs) ---------------------------------

const REEL =
    'https://reelfren.net/watch/storyreel/877541-my-catfish-girlfriend-didn-t-know-the-real-me';

test('advances a reelfren.net episode by bumping ?ep= and keeps ?lang=', () => {
    const video = makeVideo();
    const page = createPage({ videos: [video], href: REEL + '?ep=5&lang=en' });

    video.emit('ended');

    assert(
        page.location.href === REEL + '?ep=6&lang=en',
        'expected ep=6 with lang kept, got ' + page.location.href
    );
});

test("prefers reelfren's own next-episode link when one exists", () => {
    const video = makeVideo();
    const next = REEL + '?ep=6&lang=en';
    const page = createPage({ videos: [video], href: REEL + '?ep=5&lang=en', links: [{ href: next }] });

    video.emit('ended');

    assert(page.location.href === next, 'expected the next link, got ' + page.location.href);
});

test('ignores a reelfren next link for a different series', () => {
    const video = makeVideo();
    const other = 'https://reelfren.net/watch/storyreel/999999-some-other-drama?ep=6&lang=en';
    const page = createPage({ videos: [video], href: REEL + '?ep=5&lang=en', links: [{ href: other }] });

    video.emit('ended');

    assert(
        page.location.href === REEL + '?ep=6&lang=en',
        'should have ignored the other series, got ' + page.location.href
    );
});

test('keeps the host it started on when falling back to ep+1', () => {
    const video = makeVideo();
    const href = 'https://www.reelfren.net/watch/storyreel/877541-my-catfish-girlfriend-didn-t-know-the-real-me?ep=7';
    const page = createPage({ videos: [video], href });

    video.emit('ended');

    assert(
        page.location.href === href.replace('ep=7', 'ep=8'),
        'expected the subdomain preserved, got ' + page.location.href
    );
});

test('does nothing on a reelfren.net page that is not a watch page', () => {
    const video = makeVideo();
    const page = createPage({ videos: [video], href: 'https://reelfren.net/browse' });

    video.emit('ended');

    assert(page.location.href === 'https://reelfren.net/browse', 'should not have navigated');
});

test('ignores a watch page with no episode number', () => {
    const video = makeVideo();
    const page = createPage({ videos: [video], href: REEL });

    video.emit('ended');

    assert(page.location.href === REEL, 'should not navigate without an ep, got ' + page.location.href);
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

// --- report ----------------------------------------------------------------

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
