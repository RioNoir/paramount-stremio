import {NextRequest, NextResponse} from "next/server";
import {unseal} from "@/lib/auth/jwe";
import {readSessionFromKey} from "@/lib/auth/session";
import { keepAliveAgent } from "@/lib/http/agent";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

function isExpired(payload: any) {
    return !payload?.exp || Date.now() > payload.exp;
}

function buildCookieHeader(cookies: string[] | undefined): string | undefined {
    if (!cookies?.length) return undefined;
    return cookies
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

function isM3U8(url: string) {
    try {
        const u = new URL(url);
        return u.pathname.endsWith(".m3u8") || u.pathname.includes(".m3u8");
    } catch {
        return url.includes(".m3u8");
    }
}

function isLikelyText(res: Response) {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    return ct.includes("application/vnd.apple.mpegurl") || ct.includes("application/x-mpegurl") || ct.includes("text/");
}

function isParamountDomain(host: string) {
    const h = host.toLowerCase();
    return (
        h.endsWith("paramountplus.com") ||
        h.endsWith("pplusstatic.com") ||
        h.endsWith("cbsi.live.ott.irdeto.com") ||
        h.endsWith("cbsi.com")
    );
}

// Riscrive:
// - righe URL pure (variant/segment)
// - URI="..." dentro tag tipo EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA
function rewriteM3U8(body: string, req: NextRequest, key: string, token: string, upstreamBase: string) {
    const url = process.env.APP_BASE_URL || req.url;
    const origin = new URL(url).origin;

    const proxyize = (abs: string) => {
        const prox = new URL(`/api/stremio/${encodeURIComponent(key)}/proxy/hls`, origin);
        prox.searchParams.set("u", abs);
        prox.searchParams.set("t", token);
        return prox.toString();
    };

    const toAbs = (maybeUrl: string) => {
        try {
            return new URL(maybeUrl, upstreamBase).toString();
        } catch {
            return maybeUrl;
        }
    };

    return body
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            // URL “pure” su una riga (segment/variant)
            if (!trimmed.startsWith("#")) {
                return proxyize(toAbs(trimmed));
            }

            return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
                const abs = toAbs(uri);
                return `URI="${proxyize(abs)}"`;
            });
        })
        .join("\n");
}

async function fetchUpstream(url: string, bearer: string, cookieHeader?: string) {
    const u = new URL(url);
    const headers: Record<string, string> = {
        "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
    };

    // ✅ IMPORTANTISSIMO:
    // Mandiamo Authorization/Cookie SOLO ai domini Paramount/Irdeto.
    // DAI (dai.google.com) non deve riceverli.
    if (isParamountDomain(u.hostname)) {
        headers["Authorization"] = `Bearer ${bearer}`;
        if (cookieHeader) headers["Cookie"] = cookieHeader;
        headers["Origin"] = "https://www.paramountplus.com";
        headers["Referer"] = "https://www.paramountplus.com/";
    }

    // @ts-ignore
    return fetch(url, {dispatcher: keepAliveAgent, method: "GET", redirect: "follow", cache: "no-store", headers });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string; path: string[] }> }) {
    const { key, path } = await ctx.params;

    // useremò:
    // - /proxy/hls?u=...  -> auto-detect playlist vs segment
    // (manteniamo compatibilità con i tuoi link: /proxy/hls.m3u8 e /proxy/seg se li hai già)
    const mode = path?.[0] ?? "";

    const u = req.nextUrl.searchParams.get("u");
    const t = req.nextUrl.searchParams.get("t");
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    let payload: any;
    try {
        payload = await unseal(t);
    } catch {
        return new NextResponse("Invalid token", { status: 403 });
    }

    if (payload?.kind !== "pplus_proxy" || isExpired(payload)) {
        return new NextResponse("Token expired", { status: 403 });
    }

    const bearer = payload.ls_session as string;
    if (!bearer) return new NextResponse("Missing bearer", { status: 403 });

    const session = await readSessionFromKey(decodeURIComponent(key));
    const cookieHeader = buildCookieHeader(session?.cookies);

    // compat: se chiamano /proxy/hls.m3u8, forziamo playlist mode
    const forcePlaylist = mode === "hls.m3u8";
    const forceSegment = mode === "seg";

    const treatAsPlaylist = forcePlaylist || (!forceSegment && isM3U8(u));

    const res = await fetchUpstream(u, bearer, cookieHeader);

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        return new NextResponse(`Upstream ${res.status} ${res.statusText}\n${text.slice(0, 300)}`, {
            status: 502,
            headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
        });
    }

    // ✅ Playlist: riscrivi sempre
    if (treatAsPlaylist || isLikelyText(res)) {
        const text = await res.text();
        const upstreamBase = new URL(u).toString();
        const rewritten = rewriteM3U8(text, req, key, t, upstreamBase);

        return new NextResponse(rewritten, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
            },
        });
    }

    // Segment / init / key data (binario)
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "application/octet-stream";

    return new NextResponse(buf, {
        status: 200,
        headers: {
            "Content-Type": ct,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
        },
    });
}
