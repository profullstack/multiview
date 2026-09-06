# @profullstack/multiview

Several live streams on one screen, driven by a mouse, a finger or a TV remote.

Grid layout, a player per tile, solo sound, drag to rearrange, D-pad navigation,
and a pop-out into a Document Picture-in-Picture window that keeps playing while
it moves. No dependencies, no build step, one browser ES module.

It grew inside a sports site and came out when a second brand was about to copy
six hundred lines of it.

## What it does not do

**It renders no markup.** Your page and your tiles are yours, because layout,
wording and palette are the parts that should differ between brands. This drives
markup it finds, addressed entirely through `data-` attributes.

**It knows nothing about channels, playlists or accounts.** A tile carries a
`data-play` URL and that is the whole contract. Whatever authenticates or
authorises that URL is your business.

## Install

```sh
npm i @profullstack/multiview
```

Serve `src/multiview.js` to the browser however you serve your other scripts —
it needs no bundling — and include `src/multiview.css`, or copy its rules into
your own stylesheet.

```js
import { configure, initMultiview, initMultiviewAdd } from '@profullstack/multiview';

configure({ storageKey: 'yoursite.multiview', playerGlobal: '__yourPlayer' });
initMultiview();
initMultiviewAdd();
```

Call both again after a client-side navigation. Each is idempotent and does
nothing when its markup is absent, so calling them on every page is fine.

## The markup contract

On the grid page:

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-multiview` | the section | The page. Carries the settings below. |
| `data-max` | the section | How many streams the viewer's line permits at once. No tile starts past it. |
| `data-max-tiles` | the section | How many tiles the grid holds. Defaults to 4. |
| `data-mv-player-src` | the section | URL of your player bundle, fetched on the first press. |
| `data-search` | the section | Endpoint returning `{channels: [{id, title, group, live}]}`. |
| `data-mv-grid` | a child | The grid itself. |
| `data-mv-tile` | a `<template>` | Markup for one tile, stamped out for tiles added on the page. |
| `data-mv-tile-id` | a tile | The tile's id, which is what the address and the remembered set carry. |
| `data-play` | a tile | The stream URL for that tile. |
| `data-mv-screen` | in a tile | The picture. Click switches sound, or plays a stopped tile. |
| `data-mv-sound` / `data-mv-toggle` / `data-mv-remove` / `data-mv-grab` | in a tile | Sound, play/stop, remove, drag handle. |
| `data-mv-popout` | anywhere | Pop out. Removed automatically where it cannot work. |

Anywhere else, `a[data-multiview-add="<id>"]` becomes a link that carries the
grid the reader already has plus this one.

## Three decisions worth knowing

**The allowance is real and is enforced up front.** A provider line permits a
small number of simultaneous connections and suspends the account for exceeding
it. `data-max` is that number; no tile starts past it, and the module says so in
words rather than letting a server evict somebody's oldest stream — which on
this page looks like tile one going black when tile three starts.

**A television is detected by the absence of a pointer, never by user agent.**
`(pointer: none)` and not `(pointer: fine)`. A touchscreen is coarse but drags
perfectly well, so coarse alone does not count and a phone keeps its drag. On a
remote, tiles take focus, arrows move between them and OK switches the sound;
the drag handle and the pop-out are removed, because a control a remote must
skip past is worse than no control.

**Pop-out uses Document Picture-in-Picture, and moves the grid rather than
copying it.** The older element-level API is one video per browser, full stop,
which is why "picture-in-picture for four games" cannot be built out of it.
Moving the nodes keeps them playing. Where the API is absent, a plain popup
window is opened and this page's streams are stopped first — the same account
opening the same streams twice would otherwise evict its own.

## Styling

Every colour in `multiview.css` is a custom property with a fallback. Define
`--accent`, `--panel`, `--line`, `--fg`, `--muted` and `--ok` and the grid takes
your palette; define none and it is still legible. Nothing sets a font.

## Licence

MIT
