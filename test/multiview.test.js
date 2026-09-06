import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  canTransmux,
  configure,
  MAX_TILES,
  multiviewSet,
  saveMultiviewSet,
} from '../src/multiview.js';

/**
 * The module has one hard rule and the tests are mostly about it: a provider
 * line permits a small number of simultaneous connections and suspends the
 * account for exceeding it. Everything that could open a second stream is
 * therefore worth pinning, including the pieces that only run on a television.
 *
 * The behavioural half runs against a stub browser rather than a real DOM,
 * because what matters is the decisions -- how many tiles may start, which one
 * is audible, what happens where an API is missing -- and those are decidable
 * without a renderer.
 */

const src = readFileSync(new URL('../src/multiview.js', import.meta.url).pathname, 'utf8');
const css = readFileSync(new URL('../src/multiview.css', import.meta.url).pathname, 'utf8');

/** A localStorage that behaves, and one that refuses like a private window. */
const store = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

describe('the remembered tile set', () => {
  test('round-trips, and is capped at a grid', () => {
    globalThis.localStorage = store();
    configure({ storageKey: 'test.multiview' });
    saveMultiviewSet([1, 2, 3, 4, 5, 6]);
    // The last four, because the newest additions are the ones a reader means.
    expect(multiviewSet()).toEqual([3, 4, 5, 6]);
    expect(MAX_TILES).toBe(4);
  });

  test('a hostile store is empty, not an exception', () => {
    // Garbage somebody else wrote under our key, and ids that are not ids.
    globalThis.localStorage = store();
    globalThis.localStorage.setItem('test.multiview', 'not json');
    expect(multiviewSet()).toEqual([]);
    globalThis.localStorage.setItem('test.multiview', '{"not":"an array"}');
    expect(multiviewSet()).toEqual([]);
    globalThis.localStorage.setItem('test.multiview', '[1,"two",0,-3,4.5,4]');
    expect(multiviewSet()).toEqual([1, 4]);
  });

  test('storage that refuses to write is survivable', () => {
    // A private window throws on setItem. Losing the memory is acceptable;
    // throwing out of a click handler is not.
    globalThis.localStorage = {
      getItem: () => null,
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => saveMultiviewSet([1, 2])).not.toThrow();
  });

  test('two brands on one browser do not share a key', () => {
    globalThis.localStorage = store();
    configure({ storageKey: 'brand-a' });
    saveMultiviewSet([1, 2]);
    configure({ storageKey: 'brand-b' });
    expect(multiviewSet()).toEqual([]);
    configure({ storageKey: 'brand-a' });
    expect(multiviewSet()).toEqual([1, 2]);
  });
});

describe('asking whether the browser can play at all', () => {
  test('is answered without fetching the demuxer', () => {
    globalThis.window = { MediaSource: { isTypeSupported: () => true } };
    expect(canTransmux()).toBe(true);
    // iOS Safari: no MediaSource at all.
    globalThis.window = {};
    expect(canTransmux()).toBe(false);
    // An implementation that throws is a no, not a crash.
    globalThis.window = {
      MediaSource: {
        isTypeSupported() {
          throw new Error('nope');
        },
      },
    };
    expect(canTransmux()).toBe(false);
  });

  test('asks about H.264 and AAC, which is what the demuxer emits', () => {
    let asked = null;
    globalThis.window = {
      MediaSource: {
        isTypeSupported: (t) => {
          asked = t;
          return true;
        },
      },
    };
    canTransmux();
    expect(asked).toContain('avc1.42E01E');
    expect(asked).toContain('mp4a.40.2');
  });
});

describe('the line allowance, which is the whole safety property', () => {
  const body = src.slice(src.indexOf('export function initMultiview('));

  test('no tile starts past what the line permits', () => {
    expect(body).toContain('if (running.size < allowance) return true;');
    expect(body).toContain('const allowance = Math.max(1, Number(page.dataset.max) || 1);');
  });

  test('a tile is reserved BEFORE the bundle is awaited', () => {
    // Four tiles starting together would otherwise all pass the count and all
    // open, on a line that permits one.
    expect(body.indexOf('running.set(tile, { stop: null, video: null })')).toBeLessThan(
      body.indexOf('await loadPlayerBundle(src)'),
    );
  });

  test('leaving the page drops every provider connection', () => {
    expect(body).toContain("window.addEventListener('pagehide', stopAll)");
    // Chained rather than replaced, so a host's own player teardown survives.
    expect(body).toContain('const previousStop = window.__multiviewStopAll;');
  });

  test('the popup fallback stops this page first', () => {
    const at = body.indexOf("window.open(location.href, 'multiview'");
    expect(at).toBeGreaterThan(0);
    expect(body.slice(0, at).trimEnd().endsWith('for (const t of tiles()) stopTile(t);')).toBe(
      true,
    );
  });
});

describe('sound', () => {
  const body = src.slice(src.indexOf('export function initMultiview('));

  test('is solo: one tile audible at a time', () => {
    expect(body).toContain('r.video.muted = t !== tile;');
    // Muted to start, because four commentaries is noise and a muted video is
    // the only kind a browser will autoplay.
    expect(body).toContain('video.muted = true;');
  });

  test('lights the tile, not only the button', () => {
    expect(body).toContain("tile.dataset.sound = on ? '1' : '';");
    expect(css).toContain('.mv-tile[data-sound="1"]');
  });
});

describe('a television', () => {
  const body = src.slice(src.indexOf('export function initMultiview('));

  test('is detected by the absence of a pointer, never by user agent', () => {
    expect(body).toContain("window.matchMedia('(pointer: none)').matches");
    expect(body).toContain("!window.matchMedia('(pointer: fine)').matches");
    // A touchscreen is coarse and drags perfectly well, so coarse alone must
    // not turn this on or a phone loses its drag.
    expect(src).not.toContain('userAgent');
    expect(body).not.toContain("matchMedia('(pointer: coarse)')");
  });

  test('gets focusable tiles and arrow-key movement', () => {
    expect(body).toContain('tile.tabIndex = 0;');
    expect(body).toContain('ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2');
    expect(body).toContain('const cols = grid.clientWidth > 640 ? 2 : 1;');
    // A press that would leave the grid does nothing rather than wrapping.
    expect(body).toContain('if (to < 0 || to >= all.length) return;');
  });

  test('loses the controls a remote cannot use', () => {
    expect(body).toContain(
      "if (popout && (remoteOnly || !('documentPictureInPicture' in window))) {",
    );
    expect(css).toContain('[data-remote] .mv-grab');
  });
});

describe('the pop-out', () => {
  const body = src.slice(src.indexOf('export function initMultiview('));

  test('moves the grid rather than copying it, so playback continues', () => {
    expect(body).toContain('pip.document.body.append(grid)');
    expect(body).toContain("pip.addEventListener('pagehide'");
    expect(body).toContain('stage.prepend(grid)');
  });

  test('carries stylesheets by link, never inline', () => {
    // The window inherits the opener's Content-Security-Policy, and style-src
    // does not allow inline.
    expect(body).toContain('link[rel="stylesheet"]');
    expect(body).not.toContain("createElement('style')");
  });
});

describe('the package', () => {
  test('renders no markup and reaches no network of its own', () => {
    // Everything it touches, it found. A module that renders tiles would own
    // the brand's layout, which is exactly what should differ between hosts.
    expect(src).not.toContain('innerHTML =');
    // The only fetch is the host's own search endpoint, named by the page.
    expect(src.match(/fetch\(/g)?.length ?? 0).toBe(1);
    expect(src).toContain('page.dataset.search');
  });

  test('has no dependencies and needs no build', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8'),
    );
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.exports['.'].default).toBe('./src/multiview.js');
    expect(pkg.exports['./multiview.css']).toBe('./src/multiview.css');
  });

  test('names no brand in the code it ships', () => {
    // Comments may say where it came from -- provenance is worth keeping. What
    // must not carry a brand is anything that RUNS: a storage key, a window
    // name or a global would collide the moment two of our sites share a
    // browser, which is exactly the situation this package creates.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .toLowerCase();
    expect(code).not.toContain('tipoff');
    expect(code).not.toContain('genrewatch');
    expect(code).not.toContain("'tw.");
    expect(code).not.toContain("'tw-");
  });
});
