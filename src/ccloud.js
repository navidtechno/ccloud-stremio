// CCloud API client (backend of the CCloud Android app).
const API_KEY = "4F5A9C3D9A86FA54EACEDDD635185";
const BASES = [
  "https://server-hi-speed-iran.info",
  "https://hostinnegar.com",
  "https://windowsdiba.info",
];
let baseIndex = 0;
async function get(path) {
  let lastErr = null;
  for (let i = 0; i < BASES.length; i++) {
    const base = BASES[(baseIndex + i) % BASES.length];
    const url = base + path;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "CCloud/1.0", Accept: "application/json" },
        signal: AbortSignal.timeout(25000),
        redirect: "follow",
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      const json = JSON.parse(text);
      baseIndex = (baseIndex + i) % BASES.length;
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
const enc = encodeURIComponent;
module.exports = {
  movies: (page = 0, genreId = 0, sort = "created") =>
    get(`/api/movie/by/filtres/${genreId}/${sort}/${page}/${API_KEY}/`),
  series: (page = 0, genreId = 0, sort = "created") =>
    get(`/api/serie/by/filtres/${genreId}/${sort}/${page}/${API_KEY}/`),
  seasons: (seriesId) => get(`/api/season/by/serie/${seriesId}/${API_KEY}/`),
  search: (query) => get(`/api/search/${enc(query)}/${API_KEY}/`),
};
