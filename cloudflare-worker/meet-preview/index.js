/**
 * TrueBeast — Meet link previews
 * ==============================
 * Route: truebeast.io/meet/*
 *
 * GitHub Pages has no file for /meet/<eventId>, so it answers 404 with an
 * empty page and Discord/X/iMessage show no preview. For event links this
 * worker instead serves the static /meet/ page (the full app, generated at
 * build time with the planner's og: tags) with a 200, and swaps in the
 * event's own name and response count. Everything else under /meet passes
 * straight through. Subrequests to the same zone skip this worker, so
 * fetching /meet/ below goes to GitHub Pages, not back here.
 */

const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/truebeast-support/databases/(default)/documents';
// Public web API key (same one shipped in the site's JS); reads are allowed by the meetEvents rules.
const API_KEY = 'AIzaSyClA0dmz4D3TDbhwvWmUeVinW6A18NQUUU';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/meet\/([a-z0-9]{6,20})\/?$/);
    if (!match || request.method !== 'GET') return fetch(request);
    const id = match[1];

    const [shell, event, people] = await Promise.all([
      fetch(`${url.origin}/meet/`, { cf: { cacheTtl: 300, cacheEverything: true } }),
      fetch(`${FIRESTORE}/meetEvents/${id}?key=${API_KEY}&mask.fieldPaths=name`, { cf: { cacheTtl: 60 } }).catch(() => null),
      fetch(`${FIRESTORE}/meetEvents/${id}/people?key=${API_KEY}&pageSize=300&mask.fieldPaths=name`, { cf: { cacheTtl: 60 } }).catch(() => null),
    ]);
    if (!shell.ok) return fetch(request);

    let name = '';
    let count = 0;
    try { if (event?.ok) name = (await event.json()).fields?.name?.stringValue ?? ''; } catch { /* keep default */ }
    try { if (people?.ok) count = ((await people.json()).documents ?? []).length; } catch { /* keep default */ }

    const pageUrl = `https://truebeast.io/meet/${id}`;
    const title = name ? `${name} — add your times` : 'Meet — Find a time that works | TrueBeast';
    const responded = count === 0 ? 'Be the first to respond.' : `${count} ${count === 1 ? 'person has' : 'people have'} responded.`;
    const description = name
      ? `${responded} Drag over when you're free and see the best time for everyone.`
      : "Share one link. Everyone drags over when they're free, and the best time shows up instantly.";

    const setContent = (value) => ({ element(el) { el.setAttribute('content', value); } });
    const rewritten = new HTMLRewriter()
      .on('meta[property="og:title"]', setContent(title))
      .on('meta[property="og:description"]', setContent(description))
      .on('meta[name="description"]', setContent(description))
      .on('meta[property="og:url"]', setContent(pageUrl))
      .on('title', { element(el) { el.setInnerContent(name ? `${name} | Meet` : title); } })
      .transform(shell);

    return new Response(rewritten.body, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=60',
      },
    });
  },
};
