// Stremio addon powered by the CCloud backend (server-hi-speed-iran.info).
// Install in Nuvio / Stremio via the manifest URL.

const { addonBuilder } = require("stremio-addon-sdk");
const cc = require("./ccloud");

const PREFIX = "cc:";
const PER_PAGE = 30;
const CINEMETA = "https://v3-cinemeta.strem.io";

async function fetchJson(url, timeoutMs = 20000) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function normTitle(s) {
  return (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function titleMatch(a, b) {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}

// ---- object cache (catalog/search results, for meta+stream lookups) ---------
const objCache = new Map(); // "movie:<id>" | "series:<id>" -> object
function remember(item, type) {
  if (item && item.id != null) objCache.set(`${type}:${item.id}`, item);
}
function recall(type, id) {
  return objCache.get(`${type}:${id}`);
}

// ---- mapping ----------------------------------------------------------------
function img(u) {
  if (!u) return undefined;
  return u.startsWith("http") ? u : `https://server-hi-speed-iran.info/${u}`;
}

function toMetaPreview(item, type) {
  if (!item || item.id == null) return null;
  remember(item, type);
  return {
    id: `${PREFIX}${type}:${item.id}`,
    type,
    name: item.title || "Unknown",
    poster: img(item.image),
    background: img(item.cover),
    description: item.description,
    releaseInfo: item.year ? String(item.year) : undefined,
    imdbRating: item.imdb ? String(item.imdb) : undefined,
    genres: (item.genres || []).map((g) => g.title).filter(Boolean),
    runtime: item.duration,
  };
}

function parseId(id) {
  // cc:movie:<id> | cc:series:<id> | cc:series:<id>:<seasonIdx>:<epIdx>
  const parts = id.replace(PREFIX, "").split(":");
  return { type: parts[0], itemId: parts[1], se: parts[2] ? Number(parts[2]) : 0, ep: parts[3] ? Number(parts[3]) : 0 };
}

function qualityOf(s) {
  const m = /(\d{3,4})/.exec(s.quality || "");
  if (m) return m[1];
  let u = s.url || "";
  try { u = decodeURIComponent(u); } catch (e) {}
  const q = /\b(\d{3,4})p/i.exec(u);
  return q ? q[1] : (s.quality || "").trim();
}
const QUALITY_RANK = { "2160": 5, "1080": 4, "720": 3, "480": 2, "360": 1 };

function toStreams(sources) {
  const list = (sources || []).filter((s) => s && s.url);
  list.sort((a, b) => (QUALITY_RANK[qualityOf(b)] || 0) - (QUALITY_RANK[qualityOf(a)] || 0));
  return list.map((s) => ({
    url: s.url,
    title: `CCloud ${qualityOf(s)}${s.type ? " " + s.type : ""}`.trim(),
    behaviorHints: { notWebReady: false },
  }));
}

// Fallback: scan first pages of a list endpoint for an id (cache miss).
async function findInList(kind, id, pages = 3) {
  for (let p = 0; p < pages; p++) {
    const items = kind === "movie" ? await cc.movies(p) : await cc.series(p);
    const hit = (items || []).find((x) => String(x.id) === String(id));
    if (hit) {
      remember(hit, kind);
      return hit;
    }
  }
  return null;
}

// Resolve an external (IMDb) id to a CCloud item, the way Persian Streams
// answers for its providers: look the title up in CCloud search instead of
// only answering for cc: ids. Returns null when CCloud has no such title.
async function resolveExternal(type, id) {
  const parts = id.split(":");
  const imdbId = parts[0];
  const season = parts[1] ? Number(parts[1]) : null;
  const episode = parts[2] ? Number(parts[2]) : null;
  let meta;
  try {
    const data = await fetchJson(`${CINEMETA}/meta/${type}/${imdbId}.json`);
    meta = data && data.meta;
  } catch (e) {
    console.error("[tt] cinemeta", imdbId, e.message);
    return null;
  }
  if (!meta || !meta.name) return null;
  let posters = [];
  try {
    const data = await cc.search(meta.name);
    posters = data.posters || [];
  } catch (e) {
    console.error("[tt] search", meta.name, e.message);
    return null;
  }
  const year = meta.year ? parseInt(String(meta.year).slice(0, 4), 10) : null;
  let best = null, bestScore = -1;
  for (const p of posters) {
    const t = (p.type || "").toLowerCase();
    if (type === "movie" ? t !== "movie" : !(t === "serie" || t === "series")) continue;
    if (!titleMatch(p.title, meta.name)) continue;
    let score = normTitle(p.title) === normTitle(meta.name) ? 2 : 1;
    if (year && p.year && Math.abs(Number(p.year) - year) <= 1) score += 2;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  if (!best) return null;
  remember(best, type);
  return { item: best, season: season != null ? season - 1 : 0, episode: episode != null ? episode - 1 : 0 };
}

// ---- manifest ---------------------------------------------------------------
const manifest = {
  id: "community.ccloud",
  version: "1.1.0",
  name: "CCloud",
  description: "Movies & series from the CCloud catalog (unofficial addon).",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: [PREFIX, "tt"],
  catalogs: [
    { type: "movie", id: "ccloud-movies", name: "CCloud Movies", extra: [{ name: "search" }, { name: "skip" }] },
    { type: "series", id: "ccloud-series", name: "CCloud Series", extra: [{ name: "search" }, { name: "skip" }] },
  ],
};

const builder = new addonBuilder(manifest);

// ---- catalog ----------------------------------------------------------------
builder.defineCatalogHandler(async ({ type, extra }) => {
  try {
    const skip = Number((extra && extra.search ? 0 : extra && extra.skip) || 0);
    let items = [];
    if (extra && extra.search) {
      const data = await cc.search(extra.search);
      const posters = data.posters || [];
      items = posters.filter((p) => {
        const t = (p.type || "").toLowerCase();
        return type === "movie" ? t === "movie" : t === "serie" || t === "series";
      });
    } else {
      const page = Math.floor(skip / PER_PAGE);
      items = type === "movie" ? await cc.movies(page) : await cc.series(page);
      if (skip % PER_PAGE !== 0) items = items.slice(skip % PER_PAGE);
    }
    const metas = items.map((it) => toMetaPreview(it, type)).filter(Boolean);
    return { metas };
  } catch (e) {
    console.error("[catalog]", e.message);
    return { metas: [] };
  }
});

// ---- meta -------------------------------------------------------------------
builder.defineMetaHandler(async ({ type, id }) => {
  // External ids: proxy Cinemeta meta so detail pages keep working now
  // that we declare the tt prefix (we only add streams, not our own meta).
  if (!id.startsWith(PREFIX)) {
    try {
      const data = await fetchJson(`${CINEMETA}/meta/${type}/${id.split(":")[0]}.json`);
      if (data && data.meta) return { meta: data.meta };
    } catch (e) {
      console.error("[meta] cinemeta", id, e.message);
    }
    return { meta: { id, type, name: "Unavailable" } };
  }
  try {
    const { itemId } = parseId(id);
    let item = recall(type, itemId);
    if (!item) item = await findInList(type, itemId);
    const meta = (item && toMetaPreview(item, type)) || { id, type, name: "Unknown" };
    meta.id = id;
    meta.type = type;

    if (type === "series") {
      try {
        const seasons = await cc.seasons(itemId);
        const videos = [];
        (seasons || []).forEach((sn, si) => {
          (sn.episodes || []).forEach((ep, ei) => {
            videos.push({
              id: `${PREFIX}series:${itemId}:${si}:${ei}`,
              title: ep.title || `Episode ${ei + 1}`,
              season: si + 1,
              episode: ei + 1,
              overview: ep.description,
            });
          });
        });
        meta.videos = videos;
      } catch (e) {
        console.error("[meta] seasons", itemId, e.message);
      }
    }
    return { meta };
  } catch (e) {
    console.error("[meta]", id, e.message);
    return { meta: { id, type, name: "Unavailable" } };
  }
});

// ---- stream -----------------------------------------------------------------
builder.defineStreamHandler(async ({ type, id }) => {
  // External ids (e.g. tt... from Cinemeta): resolve via CCloud search.
  if (!id.startsWith(PREFIX)) {
    try {
      if (!id.startsWith("tt")) return { streams: [] };
      const hit = await resolveExternal(type, id);
      if (!hit) return { streams: [] };
      if (type === "movie") return { streams: toStreams(hit.item.sources) };
      const seasons = await cc.seasons(hit.item.id);
      const season = (seasons || [])[hit.season];
      const episode = season && (season.episodes || [])[hit.episode];
      if (!episode) return { streams: [] };
      return { streams: toStreams(episode.sources) };
    } catch (e) {
      console.error("[stream] tt", id, e.message);
      return { streams: [] };
    }
  }
  try {
    const { itemId, se, ep } = parseId(id);
    if (type === "movie") {
      let item = recall("movie", itemId);
      if (!item) item = await findInList("movie", itemId);
      if (!item) return { streams: [] };
      return { streams: toStreams(item.sources) };
    }
    // series episode
    const seasons = await cc.seasons(itemId);
    const season = (seasons || [])[se];
    const episode = season && (season.episodes || [])[ep];
    if (!episode) return { streams: [] };
    return { streams: toStreams(episode.sources) };
  } catch (e) {
    console.error("[stream]", id, e.message);
    return { streams: [] };
  }
});

module.exports = builder.getInterface();
