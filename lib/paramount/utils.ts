import { unstable_cache } from 'next/cache';
import {NextRequest} from "next/server";
import {httpClient} from "@/lib/http/client";

export const PPLUS_BASE_URL = "https://www.paramountplus.com";
export const PPLUS_AT_TOKEN_US = "ABCVvU1Pv0BRR9aWYFLAm+m8bcIJXm7a9GYpMwXFtDuq1P5ARAg6o60yilK8oQ2Eaxc=";
export const PPLUS_LOCALE_US = "en-us";
export const PPLUS_APP_VERSION = "16.2.0";
export const PPLUS_IMG_BASE = "https://wwwimage-us.pplusstatic.com/base/";
export const PPLUS_HEADER = unstable_cache(
    async () => {
        const { data: currentVersion } = await httpClient.get("https://i.mjh.nz/.apk/paramount.version");
        const version = currentVersion || PPLUS_APP_VERSION;
        return `Paramount+/${version} (com.cbs.ott; build:520000178; Android SDK 30; androidtv; SHIELD Android TV) okhttp/5.1.0`;
    },
    ['user-agent-cache'],
    { revalidate: 86400 }
);

export async function checkMyIp() {
    try {
        const res = await httpClient.get('https://ipinfo.io/json');
        console.log(`[GeoCheck] IP: ${res.data.ip}, City: ${res.data.city}, Country: ${res.data.country}, Org: ${res.data.org}`);
    } catch (e) {
        console.error("Proxy Not Working");
    }
}

export function stripJsonSuffix(s: string) {
    return s.endsWith(".json") ? s.slice(0, -5) : s;
}

export function needsParamountAuth(hostname: string) {
    const h = hostname.toLowerCase();
    //return h.endsWith("cbsi.live.ott.irdeto.com") || h.endsWith("paramountplus.com") || h.endsWith("cbsivideo.com");
    return !h.endsWith("google.com");
}

export function buildCookieHeader(cookies: string[] | undefined) {
    if (!cookies?.length) return "";
    return cookies
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

export function forwardHeaders(req: NextRequest) {
    const h: Record<string, string> = {};

    const range = req.headers.get("range");
    if (range) h["range"] = range;

    const inm = req.headers.get("if-none-match");
    if (inm) h["if-none-match"] = inm;

    const ims = req.headers.get("if-modified-since");
    if (ims) h["if-modified-since"] = ims;

    const ua = req.headers.get("user-agent");
    if (ua) h["user-agent"] = ua;

    const accept = req.headers.get("accept");
    if (accept) h["accept"] = accept;

    return h;
}

export function copyRespHeaders(headers: Headers) {
    const out = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
    });

    const pass = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
        "cache-control", // Importante per non ri-scaricare segmenti durante i glitch
        "content-encoding",
        "date" // Alcuni player usano la data per sincronizzare i buffer
    ];

    for (const k of pass) {
        const v = headers.get(k);
        if (v) out.set(k, v);
    }

    return out;
}

export function guessBaseOrigin(req: NextRequest) {
    const baseUrl = process.env.BASE_URL || req.url || "http://localhost:3000";
    return new URL(baseUrl).origin;
}

export function normImg(urlOrPath?: string | null): string | undefined {
    if (!urlOrPath) return undefined;
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) return urlOrPath;
    return new URL(urlOrPath.replace(/^\//, ""), PPLUS_IMG_BASE).toString();
}

export function msToUtc(ms?: number): string | undefined {
    if (!ms || !Number.isFinite(ms)) return undefined;
    const iso = new Date(ms).toISOString();
    return iso.slice(0, 16).replace("T", " ") + " UTC";
}

export function msToDateTimeFormat(ms?: number): string | undefined {
    if (!ms || !Number.isFinite(ms)) return undefined;

    const timezone = process.env.TIMEZONE || 'UTC';
    const d = new Date(ms);

    return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(d).replace(',', '');
}

export function pickPoster(e: any): string | undefined {
    return (
        normImg(e?.filePathThumb) ??
        normImg(e?.filepathThumb) ??
        normImg(e?.filePathWideThumb) ??
        normImg(e?.channelLogo) ??
        normImg(e?.channelLogoDark) ??
        normImg(e?.filepathFallbackImage)
    );
}

export function pickLogo(e: any): string | undefined {
    return (
        e?.filepathFallbackImage ? normImg(e?.filepathFallbackImage) : ""
    );
}

export function pickBackground(e: any): string | undefined {
    return normImg(e?.filePathWideThumb) ?? normImg(e?.filePathThumb);
}

export function pickLeagueLabel(e: any): string | undefined {
    const gd = e?.gameData;
    const a = gd?.competition ?? gd?.league ?? gd?.sport ?? gd?.leagueName ?? gd?.sportName;
    const b = gd?.tournament ?? gd?.competitionName;
    const out = [a, b].filter(Boolean).join(" • ");
    return out || undefined;
}

export function pickManifestUrl(tokenResp: any): string | null {

    const candidates: (string | undefined)[] = [
        tokenResp?.streamingUrl,
        tokenResp?.hls?.url,
        tokenResp?.hlsUrl,
        tokenResp?.playback?.hls,
        tokenResp?.playback?.url,
        tokenResp?.manifestUrl,
    ];

    const allStrings: string[] = [];
    const walk = (obj: any) => {
        if (!obj) return;
        if (typeof obj === "string") allStrings.push(obj);
        else if (Array.isArray(obj)) obj.forEach(walk);
        else if (typeof obj === "object") Object.values(obj).forEach(walk);
    };
    walk(tokenResp);

    const merged = [...candidates.filter(Boolean) as string[], ...allStrings];
    const m3u8 = merged.find((u) => typeof u === "string" && (u.includes(".m3u8") || u.includes(".mpd")));
    if (m3u8) return m3u8;

    const license = merged.find((u) => typeof u === "string" && u.includes("/widevine/getlicense"));
    if (license) return null;

    return null;
}

export function isLicenseUrl(u: string) {
    return u.includes("/widevine/getlicense") || u.toLowerCase().includes("getlicense");
}