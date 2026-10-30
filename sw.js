// Lets the app open with bad or no reception.
// - The app's own files: network first (so a new version shows as soon as it's reachable),
//   falling back to the last copy saved on the phone.
// - The app page is saved under its plain address, whatever follows the "?". An Apple Pay link
//   (?pay=...) is the same page, so every tap shares one saved copy: nothing piles up, the shop,
//   amount and card are never kept, and the copy used without reception is always the newest one.
// - Firebase's files: their address includes the version, so they never change; use the saved
//   copy straight away and only download them once.
// Firestore traffic is not touched; Firestore keeps its own offline copy of the data.
const CACHE = "hugo-budget";
const NETWORK_TIMEOUT_MS = 3000;
const MAX_OWN_FILES = 20;   // safety net: the app is a handful of files, so this is never reached in normal use

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(tidyOldCopies().catch(() => {}).then(() => self.clients.claim())));

function isFirebaseLibrary(url){
  return url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
}

// Page loads are saved and found by address without the "?..." part.
function cacheKey(request){
  if(request.mode !== "navigate") return request;
  const url = new URL(request.url);
  return url.origin + url.pathname;
}

async function cacheFirst(request){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if(cached) return cached;
  const response = await fetch(request);
  if(response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(event){
  const request = event.request;
  const key = cacheKey(request);
  const cache = await caches.open(CACHE);
  const net = fetch(request);
  try{
    const response = await Promise.race([
      net,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS))
    ]);
    if(response.ok){ event.waitUntil(save(cache, key, response.clone())); return response; }
    // A server error page is not worth showing when this phone has a saved copy.
    return await cache.match(key) || (request.mode === "navigate" ? await mainPage(cache) : undefined) || response;
  }catch(e){
    // Slow connection: show the saved copy now, but still keep the late answer so the next open is up to date.
    event.waitUntil(net.then(r => r.ok ? save(cache, key, r.clone()) : null).catch(() => {}));
    // Exactly this address first. A page load with no copy of its own gets the app's main page.
    const cached = await cache.match(key) || (request.mode === "navigate" ? await mainPage(cache) : undefined);
    if(cached) return cached;
    throw e;
  }
}

// The app is one page, saved as "/" or as "/index.html" depending on how it was opened.
async function mainPage(cache){
  return (await cache.match(self.registration.scope)) || (await cache.match(self.registration.scope + "index.html"));
}

// The saved copy must not remember the pay link it came from (its .url would hold the shop, amount and card).
async function cleanCopy(response){
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function save(cache, key, response){
  try{
    await cache.put(key, await cleanCopy(response));
    await keepFew(cache, typeof key === "string" ? key : key.url);
  }catch(e){}
}

// Never more than MAX_OWN_FILES of the app's own files; the oldest go first (never the page just saved or the app's main page).
async function keepFew(cache, justSaved){
  const keep = [justSaved, self.registration.scope];
  const others = (await cache.keys()).filter(r => new URL(r.url).origin === self.location.origin && !keep.includes(r.url));
  for(const r of others.slice(0, Math.max(0, others.length - (MAX_OWN_FILES - keep.length)))) await cache.delete(r);
}

// Older versions saved a full copy of the app for every Apple Pay link. On update, keep the newest one as the
// app's own copy (if it has none) and drop the rest.
const when = r => Date.parse(r.headers.get("date") || "") || 0;
async function tidyOldCopies(){
  const cache = await caches.open(CACHE);
  const old = (await cache.keys()).filter(r => { const u = new URL(r.url); return u.origin === self.location.origin && u.search; });
  const done = new Set();
  for(const r of [...old].reverse()){
    const u = new URL(r.url), key = u.origin + u.pathname;
    if(done.has(key)) continue;
    done.add(key);
    const copy = await cache.match(r), own = await cache.match(key);
    if(copy && (!own || when(copy) >= when(own))) await cache.put(key, await cleanCopy(copy));
  }
  for(const r of old) await cache.delete(r);
}

self.addEventListener("fetch", event => {
  if(event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if(isFirebaseLibrary(url)) event.respondWith(cacheFirst(event.request));
  else if(url.origin === self.location.origin) event.respondWith(networkFirst(event));
});
