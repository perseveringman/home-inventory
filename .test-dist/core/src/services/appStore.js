"use strict";
/**
 * App Store / 应用图标检索。
 *
 * 通过苹果官方公开的 iTunes Search API 搜索应用，拿到名称、开发者、
 * 分类和高清图标（artworkUrl512）。接口为开放 GET，支持 CORS，
 * 浏览器与 Capacitor 原生壳都能直接调用，无需自建后端。
 *
 *   搜索： https://itunes.apple.com/search?term=...&media=software&country=cn
 *   精确： https://itunes.apple.com/lookup?id=<trackId>
 *
 * 图标 CDN（is1-ssl.mzstatic.com）带 access-control-allow-origin:*，
 * 可以 fetch 成 Blob 落到 IndexedDB，做到离线可用、不依赖网络重新加载。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.upgradeArtwork = upgradeArtwork;
exports.searchAppStoreApps = searchAppStoreApps;
exports.lookupAppStoreApp = lookupAppStoreApp;
exports.fetchIconAsDataUrl = fetchIconAsDataUrl;
const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
function mapEntry(entry) {
    const name = (entry.trackName || '').trim();
    const icon = entry.artworkUrl512 || entry.artworkUrl100 || entry.artworkUrl60;
    if (!name || !icon || !entry.trackId)
        return null;
    return {
        trackId: entry.trackId,
        name,
        seller: (entry.sellerName || entry.artistName || '').trim() || undefined,
        genre: (entry.primaryGenreName || '').trim() || undefined,
        // 把 100 升级到 512，提升清晰度（mzstatic 支持改尺寸后缀）
        iconUrl: upgradeArtwork(icon),
        storeUrl: entry.trackViewUrl || undefined,
        bundleId: entry.bundleId || undefined,
    };
}
/** mzstatic 图标 URL 末尾形如 .../100x100bb.jpg，可改成 512x512 提清晰度 */
function upgradeArtwork(url, size = 512) {
    return url.replace(/\/\d+x\d+(bb)?(-\d+)?\.(jpg|png|webp)$/i, `/${size}x${size}bb.$3`);
}
/**
 * 搜索 App Store 应用。
 * 优先查指定区（默认中国区），若空结果再回退查美区，覆盖国区未上架的海外应用。
 */
async function searchAppStoreApps(term, options = {}) {
    const keyword = term.trim();
    if (!keyword)
        return [];
    const limit = Math.min(50, Math.max(1, options.limit || 12));
    const lang = options.lang || 'zh_CN';
    const primary = options.country || 'cn';
    const queryOne = async (country) => {
        const params = new URLSearchParams({
            term: keyword,
            media: 'software',
            entity: 'software',
            country,
            lang,
            limit: String(limit),
        });
        const res = await fetch(`${ITUNES_SEARCH}?${params.toString()}`, {
            method: 'GET',
            signal: options.signal,
        });
        if (!res.ok)
            throw new Error(`App Store 搜索失败 (${res.status})`);
        const data = await res.json();
        const entries = Array.isArray(data?.results) ? data.results : [];
        return entries.map(mapEntry).filter(Boolean);
    };
    let results = await queryOne(primary);
    if (!results.length && primary !== 'us') {
        try {
            results = await queryOne('us');
        }
        catch {
            // 回退失败就用主区的空结果
        }
    }
    // 按 trackId 去重，保持顺序
    const seen = new Set();
    return results.filter((r) => (seen.has(r.trackId) ? false : (seen.add(r.trackId), true)));
}
/** 用 iTunes trackId 精确查一个应用（拿最新图标/详情） */
async function lookupAppStoreApp(trackId, options = {}) {
    const params = new URLSearchParams({
        id: String(trackId),
        country: options.country || 'cn',
        lang: options.lang || 'zh_CN',
    });
    const res = await fetch(`${ITUNES_LOOKUP}?${params.toString()}`, {
        method: 'GET',
        signal: options.signal,
    });
    if (!res.ok)
        return null;
    const data = await res.json();
    const entry = Array.isArray(data?.results) ? data.results[0] : undefined;
    return entry ? mapEntry(entry) : null;
}
/**
 * 把远程图标 url 抓成 dataURL，方便落库后离线展示。
 * 抓取失败（断网 / CDN 拦截）时返回 null，调用方应回退到只存 iconUrl。
 */
async function fetchIconAsDataUrl(iconUrl, signal) {
    try {
        const res = await fetch(iconUrl, { signal });
        if (!res.ok)
            return null;
        const blob = await res.blob();
        if (!blob.size || blob.size > 512 * 1024) {
            // 体积异常（空或过大）就不内联，仅保留 url
            return blob.size ? await blobToDataUrl(blob) : null;
        }
        return await blobToDataUrl(blob);
    }
    catch {
        return null;
    }
}
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}
