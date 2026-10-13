// Stremio addon powered by the CCloud backend (server-hi-speed-iran.info).
const { addonBuilder } = require("stremio-addon-sdk");
const cc = require("./ccloud");
const PREFIX = "cc:";
const PER_PAGE = 30;
const objCache = new Map();
function remember(item, type) {
  if (item && item.id != null) objCache.set(`${type}:${item.id}`, item);
}
function recall(type, id) {
  return objCache.get(`${type}:${id}`);
}
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
  const parts = id.replace(PREFIX, "").split(":");
  return { type: parts[0], itemId: parts[1], se: parts[2] ? Number(parts[2]) : 0, ep: parts[3] ? Number(parts[3]) : 0 };
}
function qualityOf(s) {
  const m = /(\d{3,4})/.exec(s.quality || "");
  return m ? m[1] : (s.quality || "").trim();
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
const manifest = {
  id: "community.ccloud",
  version: "1.0.0",
  name: "CCloud",
  description: "Movies & series from the CCloud catalog (unofficial addon).",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: [PREFIX],
  catalogs: [
    { type: "movie", id: "ccloud-movies", name: "CCloud Movies", extra: [{ name: "search" }, { name: "skip" }] },
    { type: "series", id: "ccloud-series", name: "CCloud Series", extra: [{ name: "search" }, { name: "skip" }] },
  ],
};
const builder = new addonBuilder(manifest);
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
builder.defineMetaHandler(async ({ type, id }) => {
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
builder.defineStreamHandler(async ({ type, id }) => {
  try {
    const { itemId, se, ep } = parseId(id);
    if (type === "movie") {
      let item = recall("movie", itemId);
      if (!item) item = await findInList("movie", itemId);
      if (!item) return { streams: [] };
      return { streams: toStreams(item.sources) };
    }
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
