/**
 * Several live streams on one screen, driven by a mouse, a finger or a remote.
 *
 * Lifted out of tipoffwatch, where it grew, because a second brand was about to
 * copy six hundred lines of it and a third was already being talked about. What
 * is here is the whole client half of a multiview page: the grid, the per-tile
 * player, solo sound, drag-to-rearrange, D-pad navigation, and the pop-out into
 * a Document Picture-in-Picture window.
 *
 * WHAT IT DOES NOT DO, on purpose:
 *
 *   - It renders no markup. The page and its tiles are the host's, because a
 *     brand's layout, wording and stylesheet are the parts that should differ.
 *     This drives markup it finds, addressed entirely through data- attributes.
 *   - It knows nothing about channels, playlists or accounts. A tile carries a
 *     `data-play` URL and that is the whole contract; whatever authenticates or
 *     authorises that URL is the host's business.
 *   - It has no dependencies and needs no build. One browser ES module.
 *
 * The rule that shapes most of it: a provider line permits a small number of
 * simultaneous connections and suspends the account for exceeding it. So the
 * allowance is read from the page, no tile starts past it, and refusing in
 * words is preferred to letting the server evict somebody's oldest stream --
 * which on this page looks like tile one going black when tile three starts.
 */

/** Four tiles is a 2x2, which is what fits on half a desktop screen. */
export const MAX_TILES = 4;

/*
 * Two names that belong to the host, not to us.
 *
 * `storageKey` files the remembered tile set, and two brands on one browser
 * must not share it. `playerGlobal` is the global the host's player bundle
 * publishes itself on -- tipoffwatch's mpegts wrapper uses `__tipoffPlayer`.
 * Both are set once, before init, and both have defaults that work.
 */
let storageKey = 'multiview';
let playerGlobal = '__multiviewPlayer';

/**
 * @param {{storageKey?: string, playerGlobal?: string}} opts
 */
export function configure(opts = {}) {
  if (opts.storageKey) storageKey = opts.storageKey;
  if (opts.playerGlobal) playerGlobal = opts.playerGlobal;
}

/**
 * Can this browser transmux at all?
 *
 * Asked WITHOUT loading the bundle, which is the whole point of asking here: a
 * device that cannot decode H.264 through Media Source Extensions should be
 * told so before a quarter of a megabyte of demuxer is fetched at it.
 */
export function canTransmux() {
  try {
    return Boolean(
      window.MediaSource?.isTypeSupported?.('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),
    );
  } catch {
    return false;
  }
}

/**
 * Fetch the host's player bundle once, and hand the same promise to everybody.
 *
 * Two globals rather than module state, because the host's own page code loads
 * the same bundle for its single-stream player: sharing through `window` is
 * what stops the demuxer being fetched twice on a page that has both.
 *
 * The in-flight promise is CLEARED on failure, so a reader on a flaky
 * connection can press again rather than holding one that will never settle.
 *
 * @param {string} src
 */
export function loadPlayerBundle(src) {
  const loadingKey = `${playerGlobal}Loading`;
  if (window[playerGlobal]) return Promise.resolve(window[playerGlobal]);
  if (window[loadingKey]) return window[loadingKey];
  window[loadingKey] = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () =>
      window[playerGlobal] ? resolve(window[playerGlobal]) : reject(new Error('no player'));
    el.onerror = () => {
      window[loadingKey] = null;
      reject(new Error('could not load the player'));
    };
    document.head.append(el);
  });
  return window[loadingKey];
}

/** The tiles the reader last had, so another page can add to them. */
export function multiviewSet() {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
}

/** Remember them, capped at what a grid holds. Storage may refuse; that is fine. */
export function saveMultiviewSet(ids) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(ids.slice(-MAX_TILES)));
  } catch {
    // Private mode, or storage refused. The link still carries this one channel.
  }
}

/**
 * The Multiview link beside a channel on an event or team page.
 *
 * Ships as a link to a grid of one, which is what a reader without this script
 * gets. With it, the href carries the tiles they already have plus this one --
 * newest last, oldest dropped past four -- and a click remembers the set so the
 * next page's link continues it.
 */
export function initMultiviewAdd(root = document) {
  for (const link of root.querySelectorAll('a[data-multiview-add]')) {
    if (link.dataset.ready) continue;
    link.dataset.ready = '1';
    const id = Number(link.dataset.multiviewAdd);
    if (!Number.isInteger(id) || id < 1) continue;

    const withThis = () => [...multiviewSet().filter((x) => x !== id), id].slice(-MAX_TILES);
    const refresh = () => {
      link.href = `/multiview?c=${withThis().join(',')}`;
    };
    refresh();
    link.addEventListener('click', () => {
      saveMultiviewSet(withThis());
      refresh();
    });
  }
}

export function initMultiview(root = document) {
  const page = root.querySelector('[data-multiview]');
  if (!page || page.dataset.ready) return;
  page.dataset.ready = '1';

  const grid = page.querySelector('[data-mv-grid]');
  const stage = page.querySelector('.mv-stage');
  if (!grid || !stage) return;

  const template = page.querySelector('template[data-mv-tile]');
  const emptyNote = page.querySelector('[data-mv-empty]');
  const src = page.dataset.mvPlayerSrc;
  const allowance = Math.max(1, Number(page.dataset.max) || 1);
  const maxTiles = Math.max(1, Number(page.dataset.maxTiles) || MAX_TILES);
  const playable = canTransmux();

  /*
   * A television is a browser with no pointer.
   *
   * Everything this page grew for a desk -- drag a handle, click a picture,
   * hover a control -- is unreachable on a Fire TV, where the only inputs are
   * four arrows and OK. Rather than sniff the user agent, which is a guess that
   * ages badly, ask whether a fine pointer exists. A device that has one keeps
   * exactly the page it had; a device that does not gets focus and arrow keys.
   *
   * `pointer: none` is the honest signal for a remote. `pointer: coarse` covers
   * both a touchscreen and some TV browsers, and a touchscreen is perfectly able
   * to drag -- so coarse alone does NOT turn this on. A phone keeps its drag.
   */
  const remoteOnly =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: none)').matches &&
    !window.matchMedia('(pointer: fine)').matches;
  if (remoteOnly) page.dataset.remote = '1';

  /** tile element -> { stop, video }. A reservation has both null while the bundle loads. */
  const running = new Map();

  const tiles = () => [...grid.querySelectorAll('.mv-tile')];
  const ids = () => tiles().map((t) => Number(t.dataset.mvTileId));

  const say = (tile, text, isError = false) => {
    tile.querySelector('.mv-state')?.remove();
    if (!text) return;
    const p = document.createElement('p');
    p.className = `mv-state small${isError ? ' error' : ' muted'}`;
    p.textContent = text;
    tile.querySelector('.mv-screen')?.append(p);
  };

  const label = (tile) => {
    const toggle = tile.querySelector('[data-mv-toggle]');
    if (toggle) toggle.textContent = running.has(tile) ? 'Stop' : 'Play';
  };

  /** The address and the remembered set follow the grid, so a reload is the same grid. */
  const sync = () => {
    const list = ids();
    grid.dataset.count = String(list.length);
    emptyNote?.classList.toggle('is-hidden', list.length > 0);
    saveMultiviewSet(list);
    try {
      history.replaceState(
        {},
        '',
        list.length ? `${location.pathname}?c=${list.join(',')}` : location.pathname,
      );
    } catch {
      // Not a real page (a test), or history is off. The grid itself is fine.
    }
  };

  const stopTile = (tile) => {
    const r = running.get(tile);
    if (!r) return;
    running.delete(tile);
    try {
      r.stop?.();
    } catch {}
    r.video?.remove();
    tile.dataset.playing = '';
    label(tile);
  };

  const roomFor = (tile) => {
    if (running.size < allowance) return true;
    say(
      tile,
      allowance === 1
        ? 'Your line permits one stream at a time. Stop another tile first, or raise the number in settings if your provider allows more.'
        : `Your line permits ${allowance} streams at once. Stop another tile first.`,
    );
    return false;
  };

  const startTile = async (tile) => {
    if (running.has(tile)) return;
    if (!playable) {
      say(
        tile,
        'This browser cannot play these streams. Open the channel in VLC from its game page.',
      );
      return;
    }
    if (!roomFor(tile)) return;

    // Reserved before the bundle is awaited: four tiles starting together would
    // otherwise all pass the count above and all open, on a line that permits one.
    running.set(tile, { stop: null, video: null });
    tile.dataset.playing = '1';
    label(tile);
    say(tile, 'Starting…');

    let player;
    try {
      player = await loadPlayerBundle(src);
    } catch {
      running.delete(tile);
      tile.dataset.playing = '';
      label(tile);
      say(tile, 'The player could not be loaded. Reload the page.', true);
      return;
    }
    // Stopped or removed while the bundle was arriving.
    if (!tile.isConnected || !running.has(tile)) return;

    if (!player.supported()) {
      running.delete(tile);
      tile.dataset.playing = '';
      label(tile);
      say(tile, 'This browser cannot play these streams.', true);
      return;
    }

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.controls = false;
    // Muted so it autoplays, and because four commentaries is noise. The Sound
    // button on the tile is how one of them becomes audible.
    video.muted = true;
    video.volume = 1;
    tile.querySelector('.mv-screen')?.prepend(video);

    const stop = player.attach(
      video,
      tile.dataset.play,
      (message) => {
        // Terminal: the player has given up on this stream.
        running.delete(tile);
        video.remove();
        tile.dataset.playing = '';
        label(tile);
        setSound(tile, false);
        say(tile, message, true);
      },
      (message) => say(tile, message),
    );
    running.set(tile, { stop, video });
    video.addEventListener('playing', () => say(tile, null), { once: true });
  };

  const setSound = (tile, on) => {
    const button = tile.querySelector('[data-mv-sound]');
    if (button) button.setAttribute('aria-pressed', on ? 'true' : 'false');
    // On the tile too, so the whole frame lights up: with four pictures the
    // question "which one am I hearing" is answered by looking, not reading.
    tile.dataset.sound = on ? '1' : '';
  };

  /** Sound on this tile, and only this tile -- or off again if it already had it. */
  const toggleSound = (tile) => {
    const r = running.get(tile);
    if (!r?.video) return;
    if (r.video.muted) {
      solo(tile);
      // Unmuting is a gesture here, but a browser that still disagrees pauses
      // rather than throws; keep the picture and go back to muted.
      if (r.video.paused) {
        r.video.muted = true;
        setSound(tile, false);
        r.video.play().catch(() => {});
      }
    } else {
      r.video.muted = true;
      setSound(tile, false);
    }
  };

  /**
   * Move a tile by `delta` places in the grid. The <video> travels with it:
   * moving a node within its document does not restart the media element, which
   * is the same property the pop-out relies on when it adopts the whole grid.
   */
  const moveTile = (tile, delta) => {
    const all = tiles();
    const from = all.indexOf(tile);
    const to = Math.max(0, Math.min(all.length - 1, from + delta));
    if (from < 0 || to === from) return;
    const target = all[to];
    if (to > from) target.after(tile);
    else target.before(tile);
    sync();
  };

  /**
   * Drag by the handle. Pointer events rather than HTML drag-and-drop, which
   * touch has never had, and resolved against the tile's OWN document: after a
   * pop-out the grid lives in the PiP window and `document` is the wrong one.
   *
   * A swap happens when the pointer is over another tile; the dragged tile then
   * occupies that slot and sits under the pointer itself, so nothing flaps.
   */
  const wireDrag = (tile, handle) => {
    let dragging = false;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      handle.setPointerCapture(event.pointerId);
      tile.classList.add('is-dragging');
      grid.classList.add('is-dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const doc = tile.ownerDocument;
      const over = doc.elementFromPoint(event.clientX, event.clientY)?.closest('.mv-tile');
      if (!over || over === tile || over.parentNode !== tile.parentNode) return;
      const all = tiles();
      if (all.indexOf(over) > all.indexOf(tile)) over.after(tile);
      else over.before(tile);
    });
    const done = () => {
      if (!dragging) return;
      dragging = false;
      tile.classList.remove('is-dragging');
      grid.classList.remove('is-dragging');
      sync();
    };
    handle.addEventListener('pointerup', done);
    handle.addEventListener('pointercancel', done);
    handle.addEventListener('keydown', (event) => {
      const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
      if (!delta) return;
      event.preventDefault();
      moveTile(tile, delta);
      handle.focus();
    });
  };

  /** One audible tile at a time. */
  const solo = (tile) => {
    for (const [t, r] of running) {
      if (!r.video) continue;
      r.video.muted = t !== tile;
      setSound(t, t === tile);
    }
  };

  const wire = (tile) => {
    if (tile.dataset.wired) return;
    tile.dataset.wired = '1';
    tile.querySelector('[data-mv-toggle]')?.addEventListener('click', () => {
      if (running.has(tile)) stopTile(tile);
      else startTile(tile);
    });
    tile.querySelector('[data-mv-sound]')?.addEventListener('click', () => toggleSound(tile));
    // The picture itself: a click on a playing tile is "let me hear this one",
    // on a stopped tile it is Play. Nothing else on the page is under it.
    tile.querySelector('[data-mv-screen]')?.addEventListener('click', () => {
      if (running.has(tile)) toggleSound(tile);
      else startTile(tile);
    });
    const grab = tile.querySelector('[data-mv-grab]');
    if (grab) wireDrag(tile, grab);

    /*
     * The tile itself is a control, for the remote.
     *
     * Focusable so a D-pad can reach it at all, and answering Enter the way a
     * click on the picture answers: sound if it is playing, Play if it is not.
     * The arrows move focus between tiles rather than scrolling the page --
     * without that, pressing right on a television does nothing visible and the
     * grid looks broken.
     *
     * Wired on every device, not only a remote: a keyboard user at a desk gets
     * the same thing, and a feature that only exists behind a media query is a
     * feature nobody can test.
     */
    tile.tabIndex = 0;
    tile.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (running.has(tile)) toggleSound(tile);
        else startTile(tile);
        return;
      }
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[event.key];
      if (step === undefined) return;
      // Two columns is what the grid actually renders above 640px, so up and
      // down are a jump of two. At one column the clamp below makes both arrows
      // walk the list, which is the right behaviour for a single stack.
      const all = tiles();
      const from = all.indexOf(tile);
      const cols = grid.clientWidth > 640 ? 2 : 1;
      const delta = Math.abs(step) === 2 ? (step < 0 ? -cols : cols) : step;
      const to = from + delta;
      if (to < 0 || to >= all.length) return;
      event.preventDefault();
      all[to].focus();
    });
    tile.querySelector('[data-mv-remove]')?.addEventListener('click', () => {
      stopTile(tile);
      tile.remove();
      sync();
    });
    label(tile);
  };

  const addTile = ({ id, title, group }) => {
    if (!template || !Number.isInteger(id) || id < 1) return;
    if (ids().includes(id)) {
      const existing = tiles().find((t) => Number(t.dataset.mvTileId) === id);
      if (existing) startTile(existing);
      return;
    }
    if (tiles().length >= maxTiles) {
      results.replaceChildren(note(`That is ${maxTiles} tiles already. Remove one first.`));
      return;
    }
    const frag = template.content.cloneNode(true);
    const tile = frag.querySelector('.mv-tile');
    if (!tile) return;
    tile.dataset.mvTileId = String(id);
    tile.dataset.play = `/my/channels/${id}/stream.ts`;
    const name = tile.querySelector('.mv-title');
    if (name) {
      name.textContent = title;
      name.title = title;
      if (group) {
        const tag = document.createElement('span');
        tag.className = 'league-tag channel-tag';
        tag.textContent = group;
        name.append(tag);
      }
    }
    wire(tile);
    grid.append(tile);
    sync();
    startTile(tile);
  };

  /* ---- finding a channel on the reader's own list ---- */

  const results = page.querySelector('[data-mv-results]') ?? document.createElement('ul');
  const form = page.querySelector('[data-mv-search-form]');
  const input = form?.querySelector('input[name="q"]');
  const note = (text) => {
    const li = document.createElement('li');
    li.className = 'muted small';
    li.textContent = text;
    return li;
  };

  let searchToken = 0;
  const search = async () => {
    const term = input?.value.trim() ?? '';
    const mine = ++searchToken;
    if (term.length < 2) {
      results.replaceChildren();
      results.classList.remove('is-open');
      return;
    }
    let found = [];
    try {
      const res = await fetch(`${page.dataset.search}?q=${encodeURIComponent(term)}`, {
        headers: { accept: 'application/json' },
      });
      found = (await res.json()).channels ?? [];
    } catch {
      found = [];
    }
    if (mine !== searchToken) return;
    results.classList.add('is-open');
    if (found.length === 0) {
      results.replaceChildren(note('Nothing on your list matches that.'));
      return;
    }
    results.replaceChildren(
      ...found.map((ch) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'mv-result-name';
        name.textContent = ch.title;
        if (ch.group) {
          const tag = document.createElement('span');
          tag.className = 'league-tag channel-tag';
          tag.textContent = ch.group;
          name.append(tag);
        }
        if (ch.live === false) {
          const dead = document.createElement('span');
          dead.className = 'muted small';
          dead.textContent = ' not streaming when last checked';
          name.append(dead);
        }
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'ghost small-btn';
        add.textContent = ids().includes(ch.id) ? 'Added' : 'Add';
        add.addEventListener('click', () => {
          addTile({ id: ch.id, title: ch.title, group: ch.group });
          add.textContent = 'Added';
        });
        li.append(name, add);
        return li;
      }),
    );
  };

  if (form && input) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      search();
    });
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, 250);
    });
  }

  /* ---- popping the grid out into its own always-on-top window ---- */

  const popout = page.querySelector('[data-mv-popout]');
  /*
   * Hidden where it cannot do anything useful.
   *
   * Floating the grid over other windows is a desktop idea. On a television
   * there are no other windows, there is no Document Picture-in-Picture, and the
   * fallback -- a popup window -- is at best a second copy of the page competing
   * for the same line. A button that cannot work is worse than no button,
   * because on a remote it still takes a press to skip past.
   */
  if (popout && (remoteOnly || !('documentPictureInPicture' in window))) {
    popout.remove();
  } else if (popout) {
    popout.addEventListener('click', async () => {
      if ('documentPictureInPicture' in window) {
        try {
          const box = grid.getBoundingClientRect();
          // Asked for first, inside the click: it needs the gesture, and nothing
          // may be awaited before it.
          const pip = await window.documentPictureInPicture.requestWindow({
            width: Math.max(320, Math.round(box.width) || 960),
            height: Math.max(180, Math.round(box.height) || 540),
          });
          // The site's own stylesheets, by link and never by inline <style>: the
          // window inherits this page's Content-Security-Policy, and style-src
          // does not allow inline.
          for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
            pip.document.head.append(link.cloneNode(true));
          }
          pip.document.title = document.title;
          pip.document.body.className = 'mv-pip';
          // The grid MOVES, videos and all. Playback continues across the move;
          // that is the whole point of Document PiP over the element kind.
          pip.document.body.append(grid);
          popout.disabled = true;
          popout.textContent = 'Popped out';
          pip.addEventListener('pagehide', () => {
            stage.prepend(grid);
            popout.disabled = false;
            popout.textContent = 'Pop out';
          });
          return;
        } catch {
          // Refused, or not in a gesture any more. Fall through to a window.
        }
      }
      // No always-on-top surface in this browser. A plain popup is the next best
      // thing -- and the tiles here are stopped FIRST, because the same account
      // opening the same streams twice would evict its own.
      for (const t of tiles()) stopTile(t);
      window.open(location.href, 'multiview', 'popup,width=960,height=560');
    });
  }

  /* ---- leaving must drop the provider connections ---- */

  const stopAll = () => {
    for (const t of tiles()) stopTile(t);
  };
  const previousStop = window.__multiviewStopAll;
  window.__multiviewStopAll = () => {
    previousStop?.();
    stopAll();
  };
  window.addEventListener('pagehide', stopAll);

  /* ---- other Multiview windows on this browser ---- */

  // Two grids of the same line share one allowance, and the second one's third
  // tile evicts the first one's oldest without a word in either window. The
  // pages find each other over a BroadcastChannel and say so. Presence only:
  // nothing is synchronised, because two windows playing one set is precisely
  // the mistake this exists to name.
  const others = page.querySelector('[data-mv-others]');
  if (others && 'BroadcastChannel' in window) {
    const me = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const seen = new Set();
    const show = () => {
      const n = seen.size;
      others.textContent =
        n === 0
          ? ''
          : n === 1
            ? `Another Multiview window is open in this browser. Your line's ${allowance} stream${
                allowance === 1 ? '' : 's'
              } are shared between them; close the one you are not watching.`
            : `${n} other Multiview windows are open in this browser. Your line's ${allowance} stream${
                allowance === 1 ? '' : 's'
              } are shared between all of them.`;
      others.classList.toggle('is-hidden', n === 0);
    };
    let channel = null;
    try {
      channel = new BroadcastChannel('multiview');
      channel.addEventListener('message', (event) => {
        const { type, id } = event.data ?? {};
        if (!id || id === me) return;
        if (type === 'bye') seen.delete(id);
        else seen.add(id);
        if (type === 'hello') channel.postMessage({ type: 'here', id: me });
        show();
      });
      channel.postMessage({ type: 'hello', id: me });
      window.addEventListener('pagehide', () => channel.postMessage({ type: 'bye', id: me }));
    } catch {
      // No channel, no notice. The grid is unaffected.
    }
  }

  /* ---- go ---- */

  for (const tile of tiles()) wire(tile);
  sync();
  // A remote needs somewhere to be. Without this the first arrow press goes to
  // whatever the browser decided was first, which on a TV is usually the nav.
  if (remoteOnly) tiles()[0]?.focus();
  // The first `allowance` tiles start on their own, muted; the rest say why not.
  // A page opened to watch four things should not need four clicks first.
  tiles().forEach((tile, i) => {
    if (i < allowance) startTile(tile);
    else roomFor(tile);
  });
}
