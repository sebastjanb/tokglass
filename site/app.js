/* TokGlass for Meta Ray-Ban Display glasses.
   600×600 additive display, D-pad arrows + Enter, Back is browser history. */
'use strict';

const VERSION = '1.2.1';
// The pages are static; everything that talks to TikTok runs on the API host
// named in config.js.
const API = String(window.TOKGLASS_API || '').replace(/\/+$/, '');
const root = document.getElementById('root');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ storage */

// localStorage can throw or come back empty; nothing here may depend on it.
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('tg.' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('tg.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  },
};

function remember(key, entry, same, max) {
  const list = store.get(key, []).filter((old) => !same(old));
  list.unshift(entry);
  store.set(key, list.slice(0, max));
}

/* ------------------------------------------------------------------ follows */

// A source is a hashtag or a creator: { kind: 'tag' | 'user', value }.
const label = (source) => (source.kind === 'tag' ? '#' : '@') + source.value;
const sameSource = (a) => (b) => a.kind === b.kind && a.value === b.value;
const follows = () => store.get('follows', []);
const isFollowed = (source) => follows().some(sameSource(source));

function toggleFollow(source) {
  const on = !isFollowed(source);
  const rest = follows().filter((old) => !sameSource(source)(old));
  store.set('follows', on ? [{ kind: source.kind, value: source.value }, ...rest].slice(0, 40) : rest);
  feedCache = null;
  return on;
}

// For You is built from what the wearer follows, topped up with these so a
// first run is not empty. TikTok's own For You feed needs a signed-in account.
const STARTERS = ['fyp', 'funny', 'animals', 'satisfying', 'sports', 'viral'];
const MIX_SOURCES = 8;

function mixSources() {
  const mine = follows().slice(0, MIX_SOURCES);
  const fill = STARTERS.filter((tag) => !mine.some((source) => source.kind === 'tag' && source.value === tag))
    .slice(0, Math.max(0, 6 - mine.length))
    .map((value) => ({ kind: 'tag', value }));
  return mine.concat(fill);
}

/* ---------------------------------------------------------------------- dom */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}
const ICON = {
  play: 'M8 5.5v13l10.5-6.5z',
  heart: 'M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20z',
  tag: 'M9.5 4 7.5 20M16.5 4l-2 16M4.5 9h16M3.5 15h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  phone: 'M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zM11 18h2',
  history: 'M4 12a8 8 0 1 0 2.6-5.9M4 4.5v3.6h3.6M12 8v4.3l2.8 1.7',
};

let toastTimer = 0;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 3000);
}

const count = (n) => {
  if (!n) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};

const focusables = (el) => Array.from(el.querySelectorAll('.f:not([disabled])'));

// Moves focus to the nearest focusable in the pressed direction. Elements that
// overlap on the cross axis win, so a wide key still leads to the key above it.
function moveFocus(el, key) {
  const from = document.activeElement;
  const all = focusables(el);
  if (!all.includes(from)) {
    if (all[0]) all[0].focus({ preventScroll: true });
    return;
  }
  const a = from.getBoundingClientRect();
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  const forward = key === 'ArrowDown' || key === 'ArrowRight';
  let best = null;
  let bestScore = Infinity;
  for (const node of all) {
    if (node === from) continue;
    const b = node.getBoundingClientRect();
    const ahead = vertical
      ? (forward ? b.top - a.bottom : a.top - b.bottom)
      : (forward ? b.left - a.right : a.left - b.right);
    if (ahead < -1) continue;
    const gap = vertical
      ? Math.max(0, b.left - a.right, a.left - b.right)
      : Math.max(0, b.top - a.bottom, a.top - b.bottom);
    const drift = vertical
      ? Math.abs((a.left + a.right) - (b.left + b.right))
      : Math.abs((a.top + a.bottom) - (b.top + b.bottom));
    const score = ahead + gap * 4 + drift * 0.01;
    if (score < bestScore) { bestScore = score; best = node; }
  }
  if (best) best.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------------- api */

async function api(path) {
  const response = await fetch(API + path, { signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error((data && data.error) || `Server answered ${response.status}`);
  return data;
}

/* ------------------------------------------------------------------ screens */

let current = null;

function mount(screen) {
  if (current && current.destroy) current.destroy();
  current = screen;
  root.replaceChildren(screen.el);
  screen.focus();
}

function message(title, opts) {
  const o = opts || {};
  const buttons = (o.buttons || []).map((b) => h('button', { class: 'btn f', onclick: b.act }, b.label));
  const el = h('section', { class: 'screen' },
    h('div', { class: 'center' },
      o.spin && h('div', { class: 'spin' }),
      h('p', { class: 'big' }, title),
      o.text && h('p', {}, o.text),
      buttons));
  return {
    el,
    focus() { const f = focusables(el)[0]; if (f) f.focus({ preventScroll: true }); },
    onKey(e) { if (!e.key.startsWith('Arrow')) return false; moveFocus(el, e.key); return true; },
  };
}

/* --- home --- */

let homeIndex = 0;

function homeScreen() {
  const mine = follows();
  const watched = store.get('watched', []);
  const entries = [
    { icon: ICON.play, label: 'For You', sub: mine.length ? 'From what you follow' : 'Popular hashtags', route: { name: 'play', feed: true } },
    { icon: ICON.heart, label: 'Following', sub: mine.length ? `${mine.length} followed` : 'Nothing yet', route: { name: 'follows' } },
    { icon: ICON.tag, label: 'Hashtag', sub: 'Type or speak', route: { name: 'type', kind: 'tag', q: '' } },
    { icon: ICON.user, label: 'Creator', sub: 'By username', route: { name: 'type', kind: 'user', q: '' } },
    { icon: ICON.phone, label: 'From phone', sub: 'Send a link or tag', route: { name: 'phone' } },
    { icon: ICON.history, label: 'History', sub: watched.length ? `${watched.length} watched` : 'Nothing yet', route: { name: 'list', history: true } },
  ];
  const el = h('section', { class: 'screen' },
    h('header', { class: 'head' }, h('span', { class: 'logo' }), h('h1', {}, 'TokGlass')),
    h('div', { class: 'grid' }, entries.map((entry, i) =>
      h('button', { class: 'tile f', onclick: () => { homeIndex = i; go(entry.route); } },
        icon(entry.icon),
        h('span', { class: 'name' }, entry.label),
        h('span', { class: 'sub' }, entry.sub)))),
    h('div', { class: 'foot' }, 'v' + VERSION));
  forYou().catch(() => { /* the player reports it when For You is opened */ });
  return {
    el,
    focus() { const f = focusables(el); (f[homeIndex] || f[0]).focus({ preventScroll: true }); },
    onKey(e) { if (!e.key.startsWith('Arrow')) return false; moveFocus(el, e.key); return true; },
  };
}

/* --- on-screen keyboard --- */

const LAYERS = {
  abc: ['qwertyuiop', 'asdfghjkl⌫', 'zxcvbnmčšž'],
  num: ['1234567890', '_.ćđ⌫'],
};

// Hashtags and usernames have no spaces; a leading # or @ is dropped.
const tidy = (text) => text.trim().replace(/^[#@]+/, '').replace(/\s+/g, '').toLowerCase();

function typeScreen(route) {
  const kind = route.kind === 'user' ? 'user' : 'tag';
  const sign = kind === 'tag' ? '#' : '@';
  let layer = 'abc';
  let valueAtFocus = null;

  const input = h('input', {
    class: 'f', type: 'search', placeholder: kind === 'tag' ? '# hashtag · press to speak or write' : '@ username · press to speak or write',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': kind === 'tag' ? 'Hashtag' : 'Creator username',
  });
  input.value = route.q || '';
  const keys = h('div', { class: 'keys' });
  const sugs = h('div', { class: 'sugs' });
  const el = h('section', { class: 'screen type' }, input, keys, sugs);

  function submit(text) {
    const q = tidy(text == null ? input.value : text);
    if (!q) return toast('Type something first');
    // Keep the text on this history entry so Back returns to it.
    history.replaceState({ name: 'type', kind, q }, '', '#type');
    go({ name: 'list', kind, value: q });
  }

  function press(key) {
    if (key === '⌫') input.value = input.value.slice(0, -1);
    else if (key === 'clear') input.value = '';
    else if (key === 'layer') return drawKeys(layer === 'abc' ? 'num' : 'abc', true);
    else if (key === 'go') return submit();
    else input.value += key;
  }

  function drawKeys(next, keepToggle) {
    layer = next;
    const key = (text, value, cls) =>
      h('button', { class: 'key f' + (cls ? ' ' + cls : ''), 'data-key': value, onclick: () => press(value) }, text);
    keys.replaceChildren(
      ...LAYERS[layer].map((line) => h('div', { class: 'kr' }, Array.from(line).map((ch) => key(ch, ch)))),
      h('div', { class: 'kr' },
        key(layer === 'abc' ? '123 _ .' : 'ABC', 'layer', 'wide'),
        key('Clear', 'clear', 'wide'),
        key('Open ' + sign, 'go', 'wide go')));
    if (keepToggle) keys.querySelector('[data-key="layer"]').focus({ preventScroll: true });
  }

  input.addEventListener('focus', () => { valueAtFocus = input.value; });
  drawKeys('abc');
  sugs.replaceChildren(...store.get('recent', []).filter((source) => source.kind === kind).slice(0, 3).map((source) =>
    h('button', { class: 'sug f', onclick: () => submit(source.value) }, label(source))));

  return {
    el,
    focus() { keys.querySelector('[data-key="g"]').focus({ preventScroll: true }); },
    onKey(e) {
      if (document.activeElement === input) {
        if (e.key === 'ArrowDown') { moveFocus(el, e.key); return true; }
        if (e.key === 'ArrowUp') return true;
        // A first press on the field must reach the glasses so the composer
        // opens; only text typed since then is opened on Enter.
        if (e.key === 'Enter' && input.value.trim() && input.value !== valueAtFocus) { submit(); return true; }
        return false;
      }
      if (!e.key.startsWith('Arrow')) return false;
      moveFocus(el, e.key);
      return true;
    },
  };
}

/* --- following --- */

let followIndex = 0;

function followsScreen() {
  const mine = follows();
  if (!mine.length) {
    return message('Nothing followed yet', { text: 'Open a hashtag or a creator and press Follow. For You is built from what you follow.' });
  }
  followIndex = clamp(followIndex, 0, mine.length - 1);
  const pos = h('span', { class: 'pos' });
  const body = h('div', { class: 'rows' }, mine.map((source, i) =>
    h('button', { class: 'row slim f', 'data-i': i, onclick: () => { followIndex = i; go({ name: 'list', kind: source.kind, value: source.value }); } },
      icon(source.kind === 'tag' ? ICON.tag : ICON.user),
      h('span', { class: 't' }, label(source)))));
  const el = h('section', { class: 'screen' }, h('header', { class: 'head' }, h('h1', {}, 'Following'), pos), body);

  function select(i, focus) {
    followIndex = clamp(i, 0, mine.length - 1);
    const node = body.children[followIndex];
    if (focus) node.focus({ preventScroll: true });
    body.scrollTop = node.offsetTop - body.offsetTop - (body.clientHeight - node.offsetHeight) / 2;
    pos.textContent = `${followIndex + 1} / ${mine.length}`;
  }
  body.addEventListener('focusin', (e) => {
    const node = e.target.closest('.row');
    if (node && Number(node.dataset.i) !== followIndex) select(Number(node.dataset.i), false);
  });
  return {
    el,
    focus() { select(followIndex, true); },
    onKey(e) {
      if (e.key === 'ArrowUp') select(followIndex - 1, true);
      else if (e.key === 'ArrowDown') select(followIndex + 1, true);
      else return e.key.startsWith('Arrow');
      return true;
    },
  };
}

/* --- video lists: one hashtag, one creator, or history --- */

const listCache = new Map(); // "#cats" -> { title, items, index }, so Back from the player is instant
let playlist = null;         // the list the player walks with Up/Down

async function listScreen(route, live) {
  const source = route.history ? null : { kind: route.kind, value: route.value };
  const key = source ? label(source) : '#history';
  let st = source ? listCache.get(key) : { title: 'History', items: store.get('watched', []), index: 0 };
  if (!st) {
    mount(message('Loading…', { spin: true, text: key }));
    const data = await api(`/api/feed?${source.kind}=${encodeURIComponent(source.value)}`);
    if (!live()) return;
    st = { title: source.kind === 'user' ? `${data.title} · ${key}` : key, items: data.items, index: 0 };
    listCache.set(key, st);
    if (listCache.size > 8) listCache.delete(listCache.keys().next().value);
    remember('recent', source, sameSource(source), 12);
  }
  if (!st.items.length) {
    return mount(message(source ? 'No videos here' : 'Nothing watched yet', { text: source ? key : '' }));
  }

  const pos = h('span', { class: 'pos' });
  const follow = source && h('button', { class: 'pill f', onclick: () => {
    const on = toggleFollow(source);
    paint();
    toast(on ? `Following ${key}` : `Unfollowed ${key}`);
  } });
  const paint = () => {
    if (!follow) return;
    const on = isFollowed(source);
    follow.textContent = on ? 'Following ✓' : 'Follow';
    follow.classList.toggle('on', on);
  };
  paint();
  const body = h('div', { class: 'rows' });
  const el = h('section', { class: 'screen' },
    h('header', { class: 'head' }, h('h1', {}, st.title), pos, follow),
    body);

  const row = (video, i) => h('button', { class: 'row f', 'data-i': i, onclick: () => open(i) },
    h('span', { class: 'th' },
      // A cover address expires after some hours; an old one simply stays blank.
      video.cover && h('img', { src: video.cover, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() })),
    h('span', { class: 'txt' },
      h('div', { class: 't' }, video.desc || 'No caption'),
      h('div', { class: 'sub' }, [video.author && '@' + video.author, video.plays && count(video.plays) + ' plays'].filter(Boolean).join(' · '))));

  function open(i) {
    st.index = i;
    playlist = { items: st.items, index: i };
    go({ name: 'play', video: st.items[i] });
  }

  function select(i, focus) {
    st.index = clamp(i, 0, st.items.length - 1);
    const node = body.children[st.index];
    if (focus) node.focus({ preventScroll: true });
    body.scrollTop = node.offsetTop - body.offsetTop - (body.clientHeight - node.offsetHeight) / 2;
    pos.textContent = `${st.index + 1} / ${st.items.length}`;
  }

  body.append(...st.items.map(row));
  // Covers a browser that moves focus itself instead of sending arrow keys.
  body.addEventListener('focusin', (e) => {
    const node = e.target.closest('.row');
    if (node && Number(node.dataset.i) !== st.index) select(Number(node.dataset.i), false);
  });

  mount({
    el,
    focus() { select(st.index, true); },
    onKey(e) {
      if (!e.key.startsWith('Arrow')) return false;
      const onFollow = follow && document.activeElement === follow;
      if (e.key === 'ArrowUp') {
        if (!onFollow && st.index === 0 && follow) follow.focus({ preventScroll: true });
        else if (!onFollow) select(st.index - 1, true);
      } else if (e.key === 'ArrowDown') {
        select(onFollow ? st.index : st.index + 1, true);
      } else if (e.key === 'ArrowRight' && follow) {
        follow.focus({ preventScroll: true });
      } else if (e.key === 'ArrowLeft' && onFollow) {
        select(st.index, true);
      }
      return true;
    },
  });
}

/* --- from phone --- */

function pairingCode() {
  let code = store.get('code', '');
  if (!/^\d{6}$/.test(code)) {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    code = String(n[0] % 1000000).padStart(6, '0');
    store.set('code', code);
  }
  return code;
}

function phoneScreen() {
  const code = pairingCode();
  const POLL_MS = 2500;
  const GIVE_UP_MS = 5 * 60 * 1000;
  let timer = 0;
  let stopped = false;
  let started = Date.now();
  const status = h('p', {}, 'Waiting for your phone…');
  const spin = h('div', { class: 'spin' });
  const again = h('button', { class: 'btn f', hidden: true, onclick: () => {
    again.hidden = true; spin.hidden = false; status.textContent = 'Waiting for your phone…';
    started = Date.now(); poll();
  } }, 'Keep waiting');
  const el = h('section', { class: 'screen' },
    h('header', { class: 'head' }, h('span', { class: 'logo' }), h('h1', {}, 'From phone')),
    h('div', { class: 'center' },
      h('p', {}, 'On your phone open'),
      h('p', { class: 'url' }, (location.host + location.pathname).replace(/\/(index\.html)?$/, '') + '/phone'),
      h('p', {}, 'and enter this code'),
      h('div', { class: 'code' }, code),
      spin, status, again));

  async function poll() {
    if (stopped) return;
    if (Date.now() - started > GIVE_UP_MS) {
      spin.hidden = true; again.hidden = false; status.textContent = 'Stopped waiting.';
      again.focus({ preventScroll: true });
      return;
    }
    try {
      const data = await api('/api/relay?code=' + code);
      if (stopped) return;
      if (data && data.kind) {
        // Replaces this screen, so Back from what arrives goes home.
        const route = data.kind === 'video'
          ? { name: 'play', video: data.item || { id: data.value, desc: '', author: '' } }
          : { name: 'list', kind: data.kind, value: data.value };
        if (data.kind === 'video') playlist = null;
        history.replaceState(route, '', '#' + route.name);
        return render(route);
      }
    } catch (e) {
      status.textContent = 'No connection. Still trying…';
    }
    timer = setTimeout(poll, POLL_MS);
  }
  poll();

  return {
    el,
    focus() { if (document.activeElement) document.activeElement.blur(); },
    onKey(e) { return e.key.startsWith('Arrow'); },
    destroy() { stopped = true; clearTimeout(timer); },
  };
}

/* --- player --- */

// The video file plays in the page's own <video>. TikTok's official embed
// player is only the fallback: in the EU it opens with a cookie question that
// cannot be answered without a pointer, and it covers half the picture.
const TIKTOK = 'https://www.tiktok.com';
const FRAME = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 };
const FEED_AGE_MS = 5 * 60 * 1000;
let feedCache = null; // { at, list } so re-opening For You resumes where it was left

// For You is fetched as soon as the home screen shows, so opening it does not
// start with a wait. One request is shared by everyone who asks.
let feedLoading = null;
function forYou() {
  if (feedCache && Date.now() - feedCache.at <= FEED_AGE_MS) return Promise.resolve(feedCache);
  if (!feedLoading) {
    const asked = mixSources().map((source) => api(`/api/feed?${source.kind}=${encodeURIComponent(source.value)}`));
    feedLoading = Promise.allSettled(asked).then((results) => {
      const lists = results.filter((result) => result.status === 'fulfilled').map((result) => result.value.items);
      if (!lists.length) throw new Error('TikTok did not answer. Try again.');
      // One from each source in turn, so no source fills the start of the feed.
      const mixed = [];
      const known = new Set();
      for (let i = 0; lists.some((list) => i < list.length); i++) {
        for (const list of lists) {
          if (list[i] && !known.has(list[i].id)) { known.add(list[i].id); mixed.push(list[i]); }
        }
      }
      // Videos not watched yet come first.
      const seen = new Set(store.get('seen', []));
      const items = mixed.filter((item) => !seen.has(item.id)).concat(mixed.filter((item) => seen.has(item.id)));
      feedCache = { at: Date.now(), list: { items, index: 0 } };
      if (items[0]) lowSrc(items[0]);
      return feedCache;
    }).finally(() => { feedLoading = null; });
  }
  return feedLoading;
}

// The file an embed page hands out runs at 0.6–4 Mbit/s, too much for the
// glasses' link. /api/low finds the same video at about 40 % of that; a video
// without one, or a failed lookup, plays the full file.
const lowCache = new Map(); // video id -> Promise<address | ''>
function lowSrc(video) {
  if (!lowCache.has(video.id)) {
    lowCache.set(video.id, api('/api/low?id=' + video.id).then((found) => (found.src ? API + found.src : ''), () => ''));
    if (lowCache.size > 60) lowCache.delete(lowCache.keys().next().value);
  }
  return lowCache.get(video.id);
}

const clock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function playerScreen(route) {
  // A video opened from a list walks that list; one sent from the phone plays alone.
  let list = route.feed ? null : (playlist && playlist.items[playlist.index] && playlist.items[playlist.index].id === route.video.id
    ? playlist : { items: [route.video], index: 0 });
  let video = null;
  let media = null;   // the <video>, while the file plays directly
  let warm = null;    // { id, el }: the next video, already downloading
  let full = false;   // the full-rate file is in use because the small one failed
  let frame = null;   // the embed player, while the fallback is in use
  let ready = false;
  let stuck = false;
  let dead = false;
  let playing = false;
  let refreshed = false;
  let time = 0;
  let duration = 0;
  let loadSeq = 0;
  let nudge = 0;
  let watchdog = 0;
  let hideTimer = 0;

  const holder = h('div', { class: 'frame' });
  const cover = h('div', { class: 'state' });
  const posEl = h('div', { class: 'where' });
  const author = h('div', { class: 'author' });
  const desc = h('div', { class: 'desc' });
  const fill = h('i', {});
  const times = h('span', {});
  const hint = h('div', { class: 'hint' });
  // Holds keyboard focus so the frame never does.
  const sink = h('button', { class: 'sink', 'aria-label': 'Player' });
  const el = h('section', { class: 'screen player' },
    h('div', { class: 'stage' }, holder, cover,
      h('div', { class: 'band top' }, posEl),
      h('div', { class: 'band bottom' }, author, desc,
        h('div', { class: 'bar' }, fill),
        h('div', { class: 'times' }, times))),
    hint,
    sink);

  // The video sits alone on the display; caption and progress show for a few
  // seconds after a press and stay while nothing is playing.
  function poke() {
    el.classList.remove('idle');
    clearTimeout(hideTimer);
    if (playing) hideTimer = setTimeout(() => el.classList.add('idle'), 3500);
  }

  const show = (text, spin) => cover.replaceChildren(...(text ? [spin && h('div', { class: 'spin' }), h('p', {}, text)].filter(Boolean) : []));
  const many = () => list.items.length > 1;
  const cannotPlay = () => show(many() ? 'This video cannot play here. ▼ for the next one.' : 'This video cannot play here.');

  function progress() {
    fill.style.width = duration ? `${clamp(time / duration, 0, 1) * 100}%` : '0';
    times.textContent = duration ? `${clock(time)} / ${clock(duration)}` : '';
  }

  function setPlaying(on) {
    playing = on;
    if (on) { clearTimeout(nudge); show(''); }
    poke();
  }

  function load() {
    video = list.items[list.index];
    refreshed = false;
    full = false;
    author.textContent = video.author ? '@' + video.author : '';
    desc.textContent = video.desc || '';
    posEl.textContent = many() ? `${list.index + 1} / ${list.items.length}` : '';
    hint.textContent = (many() ? '▲ ▼ next\n' : '') + '◀ ▶ 5 s\npress: pause';
    remember('watched', video, (old) => old.id === video.id, 40);
    remember('seen', video.id, (old) => old === video.id, 400);
    if (!route.feed) history.replaceState({ name: 'play', video }, '', '#play');
    start();
  }

  function reset() {
    loadSeq++;
    ready = false; stuck = false; playing = false; time = 0; duration = 0;
    clearTimeout(nudge); clearTimeout(watchdog);
    if (media) { media.removeAttribute('src'); media.load(); }
    media = null; frame = null;
    progress();
    show('Loading…', true);
    poke();
  }

  const element = (src) => h('video', { src, playsinline: true, 'webkit-playsinline': true, preload: 'auto' });

  // Once this video is safely buffered, the next one starts downloading so a
  // swipe plays at once. It waits until then so the two never share the link.
  async function warmNext() {
    const next = list.items[list.index + 1];
    if (!next || (warm && warm.id === next.id)) return;
    const seq = loadSeq;
    const src = (await lowSrc(next)) || next.play;
    if (dead || seq !== loadSeq || !src) return;
    dropWarm();
    warm = { id: next.id, el: element(src) };
  }

  function dropWarm() {
    if (warm) { warm.el.removeAttribute('src'); warm.el.load(); }
    warm = null;
  }

  async function start() {
    reset();
    const seq = loadSeq;
    const mine = () => !dead && seq === loadSeq;
    // The still picture shows at once, while the file is found and buffered.
    holder.replaceChildren(...(video.cover ? [h('img', { src: video.cover, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() })] : []));
    sink.focus({ preventScroll: true });

    let el = null;
    if (warm && warm.id === video.id && !full) { el = warm.el; warm = null; }
    else {
      dropWarm();
      const src = (!full && await lowSrc(video)) || video.play;
      if (!mine()) return;
      if (!src) return recover();
      el = element(src);
    }
    media = el;
    media.loop = !many();
    // In the page from the start (some browsers only play attached video), but
    // unseen until its first frame so the still picture stays up.
    holder.append(media);
    const isReady = () => { ready = true; clearTimeout(watchdog); };
    media.addEventListener('loadedmetadata', () => { if (mine()) isReady(); });
    media.addEventListener('playing', () => { if (mine()) { media.classList.add('on'); holder.replaceChildren(media); setPlaying(true); } });
    media.addEventListener('waiting', () => { if (mine()) show('Loading…', true); });
    // After a seek the browser may resume without a new 'playing' event.
    media.addEventListener('canplay', () => { if (mine() && !media.paused) show(''); });
    media.addEventListener('canplaythrough', () => { if (mine()) warmNext(); });
    media.addEventListener('pause', () => { if (mine() && !media.ended) { setPlaying(false); show('Paused'); } });
    media.addEventListener('ended', () => { if (mine()) { setPlaying(false); if (!step(1)) show('End of the list'); } });
    media.addEventListener('timeupdate', () => {
      if (!mine()) return;
      time = media.currentTime || 0;
      duration = isFinite(media.duration) ? media.duration : 0;
      progress();
    });
    media.addEventListener('error', () => { if (mine()) recover(); });
    if (media.readyState >= 1) isReady();       // a warmed video is already loaded
    if (media.readyState >= 4) warmNext();
    // Refused autoplay leaves the video waiting for a press.
    const started = media.play();
    if (started && started.catch) started.catch((error) => { if (mine() && error.name === 'NotAllowedError') show('Press to play'); });
    watchdog = setTimeout(() => { if (mine() && !ready) recover(); }, 20000);
  }

  // The small file failing falls back to the full one. A full file's address
  // lasts about two days: an old one (History) is fetched again once; after
  // that TikTok's own player gets a try.
  async function recover() {
    const seq = loadSeq;
    if (!full && video.play) { full = true; lowCache.set(video.id, Promise.resolve('')); return start(); }
    if (!refreshed) {
      refreshed = true;
      try {
        const fresh = await api('/api/video?id=' + video.id);
        if (dead || seq !== loadSeq) return;
        if (fresh.play && fresh.play !== video.play) {
          Object.assign(video, fresh);
          remember('watched', video, (old) => old.id === video.id, 40);
          return start();
        }
      } catch (error) {
        if (dead || seq !== loadSeq) return;
        if (/private or was removed/.test(error.message)) { reset(); return show(error.message + (many() ? '. ▼ for the next one.' : '.')); }
      }
    }
    startFrame();
  }

  const send = (type, value) => { if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type, value, 'x-tiktok-player': true }, TIKTOK); };

  function startFrame() {
    reset();
    const params = 'autoplay=1&controls=0&progress_bar=0&play_button=0&volume_control=0&fullscreen_button=0&timestamp=0'
      + `&music_info=0&description=0&rel=0&native_context_menu=0&closed_caption=0&loop=${many() ? 0 : 1}`;
    frame = h('iframe', {
      src: `${TIKTOK}/player/v1/${video.id}?${params}`,
      allow: 'autoplay; encrypted-media', tabindex: '-1', scrolling: 'no', title: 'TikTok video',
    });
    holder.replaceChildren(frame);
    sink.focus({ preventScroll: true });
    watchdog = setTimeout(() => { if (!ready) { stuck = true; show('The TikTok player did not load. Press to try again.'); } }, 15000);
  }

  function onMessage(e) {
    if (dead || !frame || e.origin !== TIKTOK || e.source !== frame.contentWindow) return;
    const data = e.data;
    if (!data || typeof data !== 'object' || !data['x-tiktok-player']) return;
    if (data.type === 'onPlayerReady') {
      ready = true;
      clearTimeout(watchdog);
      send('unMute');
      send('play');
      nudge = setTimeout(() => { if (!playing) show('Press to play'); }, 5000); // autoplay was refused
    } else if (data.type === 'onStateChange') {
      if (data.value === FRAME.PLAYING) setPlaying(true);
      else if (data.value === FRAME.BUFFERING) show('Loading…', true);
      else if (data.value === FRAME.PAUSED) { setPlaying(false); show('Paused'); }
      else if (data.value === FRAME.ENDED) { setPlaying(false); if (!step(1)) show('End of the list'); }
    } else if (data.type === 'onCurrentTime' && data.value) {
      time = data.value.currentTime || 0;
      duration = data.value.duration || 0;
      progress();
    } else if (data.type === 'onError' || data.type === 'onPlayerError') {
      clearTimeout(nudge); clearTimeout(watchdog);
      setPlaying(false);
      cannotPlay();
    }
  }
  window.addEventListener('message', onMessage);

  function step(dir) {
    if (!list) return false;
    const i = list.index + dir;
    if (i < 0 || i >= list.items.length) return false;
    list.index = i;
    load();
    return true;
  }

  function toggle() {
    if (media) {
      if (media.paused) { const p = media.play(); if (p && p.catch) p.catch(() => {}); } else media.pause();
    } else if (frame && ready) {
      send(playing ? 'pause' : 'play');
    } else if (stuck) {
      start(); // a second try for a player that never came up
    }
  }

  function seek(by) {
    if (!ready || !duration) return;
    time = clamp(time + by, 0, Math.max(0, duration - 1));
    if (media) media.currentTime = time; else send('seekTo', time);
    progress();
  }

  // If the frame takes focus anyway, key presses would vanish into it.
  const refocus = () => setTimeout(() => { if (!dead) { window.focus(); sink.focus({ preventScroll: true }); } }, 0);
  window.addEventListener('blur', refocus);

  async function loadFeed() {
    show('Loading For You…', true);
    try {
      const feed = await forYou();
      if (dead) return;
      if (!feed.list.items.length) return show('Nothing to show right now.');
      list = feed.list;
      load();
    } catch (error) {
      if (!dead) show(`${error.name === 'TimeoutError' ? 'TikTok took too long to answer.' : error.message} Press to try again.`);
    }
  }

  if (list) load(); else loadFeed();

  return {
    el,
    focus() { sink.focus({ preventScroll: true }); },
    onKey(e) {
      if (e.key !== 'Enter' && !e.key.startsWith('Arrow')) return false;
      poke();
      if (!list) { if (e.key === 'Enter' && !e.repeat) loadFeed(); return true; }
      if (e.key === 'Enter') { if (!e.repeat) toggle(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') seek(e.key === 'ArrowRight' ? 5 : -5);
      else if (!e.repeat && !step(e.key === 'ArrowDown' ? 1 : -1)) {
        toast(e.key === 'ArrowDown' ? 'Last video in the list' : 'First video in the list');
      }
      return true;
    },
    destroy() {
      dead = true;
      clearTimeout(nudge); clearTimeout(watchdog); clearTimeout(hideTimer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('blur', refocus);
      if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
      dropWarm();
      holder.replaceChildren();
    },
  };
}

/* ------------------------------------------------------------------- router */

// Back is browser history. Deepest paths are home → keyboard → list → player
// and home → following → list → player: four entries, inside the platform's
// limit of five. Do not add a level.
let renderSeq = 0;

function go(route) {
  history.pushState(route, '', '#' + route.name);
  render(route);
}

async function render(route) {
  const seq = ++renderSeq;
  const live = () => seq === renderSeq;
  try {
    // Mounted synchronously from the press so playback counts as user-initiated.
    if (route.name === 'play' && (route.feed || route.video)) return mount(playerScreen(route));
    if (route.name === 'type') return mount(typeScreen(route));
    if (route.name === 'follows') return mount(followsScreen());
    if (route.name === 'phone') return mount(phoneScreen());
    if (route.name === 'list') return await listScreen(route, live);
    return mount(homeScreen());
  } catch (error) {
    if (!live()) return;
    mount(message("Couldn't load this", {
      text: error.name === 'TimeoutError' ? 'TikTok took too long to answer.' : error.message,
      buttons: [{ label: 'Try again', act: () => render(route) }],
    }));
  }
}

window.addEventListener('popstate', (e) => render(e.state || { name: 'home' }));

document.addEventListener('keydown', (e) => {
  const a = document.activeElement;
  const typing = a && a.tagName === 'INPUT';
  if (e.key === 'Escape' || (e.key === 'Backspace' && !typing)) {
    // Desktop stand-in for the glasses' Back gesture.
    e.preventDefault();
    if (history.state && history.state.name !== 'home') history.back();
    return;
  }
  if (current && current.onKey && current.onKey(e)) {
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter' && !typing) {
    e.preventDefault();
    if (!e.repeat && a && a !== document.body) a.click();
  }
});

window.addEventListener('pagehide', () => { if (current && current.destroy) current.destroy(); });

history.replaceState({ name: 'home' }, '', location.pathname + location.search);
render({ name: 'home' });
