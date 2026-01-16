import {NextRequest} from "next/server";

const PPLUS_IMG_BASE = "https://wwwimage-us.pplusstatic.com/base/";

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

export function copyRespHeaders(res: Response) {
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
        const v = res.headers.get(k);
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