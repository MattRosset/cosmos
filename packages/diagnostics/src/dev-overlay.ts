import type { AppError } from '@cosmos/core-types';
import type { ErrorTransport } from './sink';
import { __setOverlaySink } from './sink';

/** Max rows kept in the overlay list (the sink keeps the true count). */
const MAX_ROWS = 20;

let _el: HTMLElement | null = null;
let _listEl: HTMLElement | null = null;
let _headerEl: HTMLElement | null = null;
let _seen = 0;

function setHeader(): void {
  if (_headerEl !== null) _headerEl.textContent = `cosmos errors: ${_seen}`;
}

function renderRow(e: AppError): void {
  if (_listEl === null) return;
  const row = document.createElement('div');
  row.style.cssText =
    'padding:4px 6px;border-top:1px solid #511;font:11px/1.4 monospace;white-space:pre-wrap;word-break:break-word;';
  const ctx = e.context !== undefined ? ` ${JSON.stringify(e.context)}` : '';
  row.textContent = `${e.kind} · ${e.name}: ${e.message}${ctx}`;
  _listEl.appendChild(row);
  while (_listEl.childElementCount > MAX_ROWS && _listEl.firstChild !== null) {
    _listEl.removeChild(_listEl.firstChild);
  }
}

/** A ready-made transport that writes to the dev overlay (used internally by
 *  installDevOverlay; exported so tests can assert routing). No-op until mounted. */
export const devOverlayTransport: ErrorTransport = (e) => {
  if (_el === null) return;
  _seen += 1;
  setHeader();
  renderRow(e);
};

/** Mounts a fixed-position overlay that lists recent AppErrors. Idempotent
 *  (mounts exactly one element). Returns a teardown fn. No-op when `document`
 *  is undefined (SSR/Node). The app calls this only in DEV (TASK-056). */
export function installDevOverlay(target?: HTMLElement): () => void {
  if (typeof document === 'undefined') return () => {};
  if (_el !== null) return teardown;

  const el = document.createElement('div');
  el.setAttribute('data-cosmos-dev-overlay', '');
  el.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:2147483647;max-width:420px;max-height:50vh;' +
    'display:flex;flex-direction:column;background:rgba(40,0,0,0.92);color:#fdd;' +
    'border:1px solid #a33;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,0.5);' +
    'pointer-events:none;overflow:hidden;';

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 6px;' +
    'font:bold 11px/1.4 monospace;background:#600;';

  const title = document.createElement('span');
  _headerEl = title;

  const clear = document.createElement('button');
  clear.textContent = 'clear';
  clear.style.cssText =
    'pointer-events:auto;cursor:pointer;font:11px monospace;background:#a33;color:#fff;' +
    'border:0;border-radius:3px;padding:1px 6px;';
  clear.addEventListener('click', () => {
    if (_listEl !== null) _listEl.replaceChildren();
    _seen = 0;
    setHeader();
  });

  header.appendChild(title);
  header.appendChild(clear);

  const list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;pointer-events:auto;';

  el.appendChild(header);
  el.appendChild(list);
  (target ?? document.body).appendChild(el);

  _el = el;
  _listEl = list;
  _seen = 0;
  setHeader();
  __setOverlaySink(devOverlayTransport);

  return teardown;
}

function teardown(): void {
  if (_el !== null) _el.remove();
  _el = null;
  _listEl = null;
  _headerEl = null;
  _seen = 0;
  __setOverlaySink(null);
}
