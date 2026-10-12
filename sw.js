// Lets the app open with bad or no reception.
// - The app's own files: network first (so a new version shows as soon as it's reachable),
//   falling back to the last copy saved on the phone.
// - Firebase's files: their address includes the version, so they never change; use the saved
//   copy straight away and only download them once.
// Firestore traffic is not touched; Firestore keeps its own offline copy of the data.
const CACHE = "hugo-budget";
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function isFirebaseLibrary(url){
  return url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
}

async function cacheFirst(request){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if(cached) return cached;
  const response = await fetch(request);
  if(response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request){
  const cache = await caches.open(CACHE);
  try{
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS))
    ]);
    if(response.ok) cache.put(request, response.clone());
    return response;
  }catch(e){
    const cached = await cache.match(request, { ignoreSearch: true });
    if(cached) return cached;
    throw e;
  }
}

self.addEventListener("fetch", event => {
  if(event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if(isFirebaseLibrary(url)) event.respondWith(cacheFirst(event.request));
  else if(url.origin === self.location.origin) event.respondWith(networkFirst(event.request));
});
