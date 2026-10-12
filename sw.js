// Lets the app open with bad or no reception. Network first (so a new version shows as soon as
// it's reachable), falling back to the last copy saved on the phone. Firestore traffic is not
// touched; Firestore keeps its own offline copy of the data.
const CACHE = "hugo-budget";
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function shouldHandle(request){
  if(request.method !== "GET") return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin
    || (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
}

self.addEventListener("fetch", event => {
  if(!shouldHandle(event.request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try{
      const response = await Promise.race([
        fetch(event.request),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS))
      ]);
      if(response.ok) cache.put(event.request, response.clone());
      return response;
    }catch(e){
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if(cached) return cached;
      throw e;
    }
  })());
});
