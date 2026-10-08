// TokGlass API on Cloudflare Workers. The pages are static (GitHub Pages) and
// a browser cannot read TikTok itself (no CORS), so everything that talks to
// TikTok lives here. Only public pages are read: no account, no keys.
//
//   /api/feed?tag=cats | ?user=tiktok   video list of one hashtag or creator
//   /api/video?url=… | ?id=…            one video from a pasted link or an id
//   /api/low?id=…                       the same video at about 40 % of the bitrate
//   /v?u=…&t=…                          streams that smaller file
//   /api/relay                          phone → glasses hand-over by 6-digit code

const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const TAG = /^[\p{L}\p{N}_]{1,60}$/u;
const USER = /^[\w.]{2,24}$/;
const VIDEO = /^\d{15,22}$/;
const CODE = /^\d{6}$/;
const FEED_CACHE = 'public, max-age=120, s-maxage=300';

/* ------------------------------------------------------------------ helpers */

const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
});

class Missing extends Error {}

// The JSON inside <script id="…">. Found by position, not by a pattern over
// the whole page: the pages are 300 KB and CPU time here is counted.
function scriptJson(html, id) {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) return null;
  const from = html.indexOf('>', at) + 1;
  const to = html.indexOf('</script>', from);
  return to < 0 ? null : JSON.parse(html.slice(from, to));
}

/* ------------------------------------------------------- TikTok embed pages */

// The same pages a blog loads when it embeds a creator, a hashtag or a video.
// Unknown creators and hashtags answer 400 with a normal page, so the status
// is not checked here.
async function embed(path) {
  const response = await fetch(`https://www.tiktok.com/embed/${path}`, {
    headers: { 'User-Agent': WEB_UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000),
  });
  const state = scriptJson(await response.text(), '__FRONTITY_CONNECT_STATE__');
  if (!state) throw new Error(`TikTok answered ${response.status}`);
  const data = state.source.data;
  const key = Object.keys(data).find((name) => name.startsWith('/embed'));
  if (!key) throw new Error('TikTok sent an empty page');
  return data[key];
}

const item = (video) => ({
  id: video.id,
  desc: (video.desc || '').trim(),
  author: video.authorUniqueId || '',
  cover: video.coverUrl || '',
  play: video.playAddr || '',
  plays: video.playCount || 0,
});

async function creator(name) {
  const page = await embed('@' + encodeURIComponent(name));
  if (page.isError) throw new Missing(`No creator @${name}`);
  if (page.userInfo && page.userInfo.privateAccount) throw new Missing(`@${name} is private`);
  return { title: (page.userInfo && page.userInfo.nickname) || name, items: (page.videoList || []).map(item) };
}

async function hashtag(name) {
  const page = await embed('tag/' + encodeURIComponent(name));
  if (page.isError) throw new Missing(`No hashtag #${name}`);
  return { title: '#' + name, items: (page.videoList || []).map(item) };
}

async function video(id) {
  const page = await embed('v2/' + id);
  const info = page.videoData && page.videoData.itemInfos;
  if (page.isError || !info) throw new Missing('This video is private or was removed');
  const author = page.videoData.authorInfos || {};
  return {
    id: info.id,
    desc: (info.text || '').trim(),
    author: author.uniqueId || '',
    cover: (info.covers || [])[0] || '',
    play: ((info.video && info.video.urls) || [])[0] || '',
    plays: info.playCount || 0,
  };
}

/* --------------------------------------------------------------------- feed */

async function feed(params) {
  const tag = (params.get('tag') || '').replace(/^#/, '').toLowerCase();
  const user = (params.get('user') || '').replace(/^@/, '').toLowerCase();
  try {
    if (tag) {
      if (!TAG.test(tag)) return json({ error: 'A hashtag has letters, digits and _ only.' }, 400);
      return json(await hashtag(tag), 200, FEED_CACHE);
    }
    if (user) {
      if (!USER.test(user)) return json({ error: 'A username has letters, digits, _ and . only.' }, 400);
      return json(await creator(user), 200, FEED_CACHE);
    }
    return json({ error: 'tag or user is required' }, 400);
  } catch (error) {
    if (error instanceof Missing) return json({ error: error.message }, 404);
    return json({ error: 'TikTok did not answer. Try again.' }, 502);
  }
}

/* -------------------------------------------------------------- pasted link */

const LINK_HOSTS = /^(www\.|m\.|vm\.|vt\.)?tiktok\.com$/;
const IN_PATH = /\/(?:video|photo|v)\/(\d{15,22})/;

// Short share links (vm.tiktok.com, tiktok.com/t/…) are followed to the video.
// Only redirect targets are read, and only on tiktok.com.
async function idFrom(text) {
  if (VIDEO.test(text)) return text;
  let url;
  try { url = new URL(/^https?:\/\//.test(text) ? text : 'https://' + text); } catch (e) { return ''; }
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== 'https:' || !LINK_HOSTS.test(url.hostname)) return '';
    const found = IN_PATH.exec(url.pathname);
    if (found) return found[1];
    const response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': WEB_UA }, signal: AbortSignal.timeout(6000) });
    const next = response.headers.get('location');
    if (!next) return '';
    url = new URL(next, url);
  }
  return '';
}

async function oneVideo(params) {
  const text = (params.get('id') || params.get('url') || '').trim().slice(0, 500);
  try {
    const id = await idFrom(text);
    if (!id) return json({ error: 'That is not a TikTok video link.' }, 400);
    return json(await video(id));
  } catch (error) {
    if (error instanceof Missing) return json({ error: error.message }, 404);
    return json({ error: 'TikTok did not answer. Try again.' }, 502);
  }
}

/* --------------------------------------------------------- data-saver video */

// An embed page hands out one full-rate file (0.6–4 Mbit/s). The video's own
// page also lists a "lowest" rendition at roughly 40 % of that. Those files
// only load with TikTok's session cookie and referrer, which a page on
// another site cannot send, so /v streams them.

// Only TikTok's own video hosts are ever fetched, so this is no open proxy.
const FILE_HOSTS = /^v[\w-]+\.(tiktok\.com|tiktokcdn(-[a-z]+)?\.com)$/;
const TOKEN = /^[\w.~%+\/=-]{8,400}$/;

async function low(params) {
  const id = params.get('id') || '';
  if (!VIDEO.test(id)) return json({ error: 'bad id' }, 400);
  const page = await fetch(`https://www.tiktok.com/@_/video/${id}`, {
    headers: { 'User-Agent': WEB_UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(7000),
  });
  const chain = page.headers.getSetCookie().map((line) => /^tt_chain_token=([^;]+)/.exec(line)).find(Boolean);
  const data = scriptJson(await page.text(), '__UNIVERSAL_DATA_FOR_REHYDRATION__');
  const detail = data && data.__DEFAULT_SCOPE__ && data.__DEFAULT_SCOPE__['webapp.video-detail'];
  const info = detail && detail.itemInfo && detail.itemInfo.itemStruct && detail.itemInfo.itemStruct.video;
  const lowest = ((info && info.bitrateInfo) || [])
    .filter((entry) => entry.CodecType === 'h264' && entry.PlayAddr && entry.PlayAddr.UrlList)
    .sort((a, b) => a.Bitrate - b.Bitrate)[0];
  const file = lowest && lowest.PlayAddr.UrlList.find((url) => { try { return FILE_HOSTS.test(new URL(url).hostname); } catch (e) { return false; } });
  if (!chain || !file) return json({ error: 'no smaller file' }, 404);
  // The file's address lasts for hours, so a short cache is safe.
  return json({
    src: `/v?u=${encodeURIComponent(file)}&t=${encodeURIComponent(chain[1])}`,
    kbps: Math.round(lowest.Bitrate / 1000),
    full: Math.round((info.bitrate || 0) / 1000),
  }, 200, 'public, max-age=600');
}

async function stream(request, params) {
  let file;
  try { file = new URL(params.get('u') || ''); } catch (e) { return json({ error: 'bad file' }, 400); }
  const token = params.get('t') || '';
  if (file.protocol !== 'https:' || !FILE_HOSTS.test(file.hostname) || !TOKEN.test(token)) return json({ error: 'bad file' }, 400);
  const headers = { 'User-Agent': WEB_UA, Referer: 'https://www.tiktok.com/', Cookie: `tt_chain_token=${token}` };
  const range = request.headers.get('range');
  if (range) headers.Range = range;
  const upstream = await fetch(file, { headers, redirect: 'manual' });
  if (upstream.status !== 200 && upstream.status !== 206) return json({ error: `TikTok answered ${upstream.status}` }, 502);
  const out = new Headers({ 'Cache-Control': 'private, max-age=3600', 'Accept-Ranges': 'bytes' });
  for (const name of ['content-type', 'content-length', 'content-range']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/* -------------------------------------------------------------------- relay */

// Hands a hashtag, a creator or one video from the phone page to the glasses.
// The phone stores it under the 6-digit code the glasses show; the glasses
// collect it once.

const MAX_AGE_MS = 10 * 60 * 1000;
const VALID = { tag: TAG, user: USER, video: VIDEO };
const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

export class Relay {
  constructor(state) { this.storage = state.storage; }

  async fetch(request) {
    if (request.method === 'GET') {
      const entry = await this.storage.get('entry');
      if (!entry) return new Response(null, { status: 204 });
      await this.storage.delete('entry');
      if (Date.now() - entry.at > MAX_AGE_MS) return new Response(null, { status: 204 });
      return json({ kind: entry.kind, value: entry.value, item: entry.item });
    }
    await this.storage.put('entry', await request.json());
    return json({ ok: true });
  }
}

async function relay(request, params, env) {
  if (request.method === 'GET') {
    const code = params.get('code') || '';
    if (!CODE.test(code)) return json({ error: 'bad code' }, 400);
    const answer = await env.RELAY.get(env.RELAY.idFromName(code)).fetch('https://relay/');
    return new Response(answer.body, { status: answer.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !CODE.test(body.code)) return json({ error: 'bad code' }, 400);
    const pattern = VALID[body.kind];
    const value = clip(body.value, 60).toLowerCase();
    if (!pattern || !pattern.test(value)) return json({ error: 'nothing to send' }, 400);
    // A video travels with its caption so the glasses need no second lookup.
    const from = body.kind === 'video' && body.item && typeof body.item === 'object' ? body.item : null;
    const entry = { at: Date.now(), kind: body.kind, value };
    if (from) {
      entry.item = { id: value, desc: clip(from.desc, 300), author: clip(from.author, 24), cover: clip(from.cover, 600), play: clip(from.play, 1200), plays: Number(from.plays) || 0 };
    }
    await env.RELAY.get(env.RELAY.idFromName(body.code)).fetch('https://relay/', { method: 'POST', body: JSON.stringify(entry) });
    return json({ ok: true });
  }
  return json({ error: 'method not allowed' }, 405);
}

/* ------------------------------------------------------------------- router */

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const params = url.searchParams;
  switch (url.pathname) {
    case '/api/feed': {
      // One hashtag is asked for by every wearer; the edge keeps it 5 minutes.
      const cached = await caches.default.match(url.href);
      if (cached) return cached;
      const fresh = await feed(params);
      if (fresh.status === 200) ctx.waitUntil(caches.default.put(url.href, fresh.clone()));
      return fresh;
    }
    case '/api/video': return oneVideo(params);
    case '/api/low': return low(params).catch(() => json({ error: 'TikTok did not answer.' }, 502));
    case '/api/relay': return relay(request, params, env);
    case '/v': return stream(request, params).catch(() => json({ error: 'TikTok did not answer.' }, 502));
    default: return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').includes(origin);
    const cors = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    }
    const answer = await route(request, env, ctx);
    const out = new Response(answer.body, answer);
    for (const name in cors) out.headers.set(name, cors[name]);
    return out;
  },
};
