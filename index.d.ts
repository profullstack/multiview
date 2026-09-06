/**
 * Several live streams on one screen, driven by a mouse, a finger or a remote.
 *
 * The module renders no markup. It drives markup the host already rendered,
 * addressed entirely through `data-` attributes — see the README for the
 * contract each one carries.
 */

export declare const MAX_TILES: 4;

/**
 * Name the two things that belong to the host rather than to the module.
 *
 * Call before `initMultiview`. Both have working defaults.
 *
 * @param opts.storageKey  where the remembered tile set is filed in
 *   `localStorage`. Two brands on one browser must not share it.
 * @param opts.playerGlobal  the global the host's player bundle publishes
 *   itself on, shared with the host's own single-stream player so the demuxer
 *   is fetched once per page rather than twice.
 */
export declare function configure(opts?: { storageKey?: string; playerGlobal?: string }): void;

/**
 * Whether this browser can decode H.264 through Media Source Extensions.
 *
 * Answered without loading the player bundle, which is the point: a device that
 * cannot decode should be told so before a quarter of a megabyte is fetched at
 * it. False on iOS Safari, which has no MSE.
 */
export declare function canTransmux(): boolean;

/** Fetch the host's player bundle once, handing the same promise to everybody. */
export declare function loadPlayerBundle(src: string): Promise<unknown>;

/** The tile ids the reader last had, so another page can add to them. */
export declare function multiviewSet(): number[];

/** Remember them, capped at `MAX_TILES`. Silent when storage refuses. */
export declare function saveMultiviewSet(ids: number[]): void;

/**
 * Wire the "add this to the grid" links on any page.
 *
 * Each `a[data-multiview-add="<id>"]` keeps its href pointing at the grid the
 * reader already has plus this one, and a click remembers the set.
 */
export declare function initMultiviewAdd(root?: ParentNode): void;

/**
 * Wire the grid itself: players, solo sound, drag, D-pad and the pop-out.
 *
 * Looks for `[data-multiview]` under `root` and does nothing if it is absent,
 * so it is safe to call on every page and after a client-side navigation.
 */
export declare function initMultiview(root?: ParentNode): void;
