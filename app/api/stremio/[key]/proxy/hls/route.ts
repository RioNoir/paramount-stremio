import { NextRequest, NextResponse } from "next/server";
import { readSessionFromKey } from "@/lib/auth/session";
import { unseal } from "@/lib/auth/jwe";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function needsParamountAuth(hostname: string) {
    const h = hostname.toLowerCase();
    return h.endsWith("cbsi.live.ott.irdeto.com") || h.endsWith("paramountplus.com") || h.endsWith("cbsivideo.com");
}

function buildCookieHeader(cookies: string[] | undefined) {
    if (!cookies?.length) return "";
    return cookies
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

function guessBaseOrigin(req: NextRequest) {
    const baseUrl = process.env.BASE_URL || req.url || "http://localhost:3000";
    return new URL(baseUrl).origin;
}

function rewriteM3U8(params: {
    text: string;
    upstreamUrl: URL;
    baseOrigin: string;
    key: string;
    token: string;
}) {
    const { text, upstreamUrl, baseOrigin, key, token } = params;

    const toProxy = (absUrl: string) => {
        const isManifest = absUrl.includes(".m3u8");
        const endpoint = isManifest ? "hls" : "seg";
        const u = new URL(`/api/stremio/${key}/proxy/${endpoint}`, baseOrigin);
        u.searchParams.set("u", Buffer.from(absUrl.toString()).toString('base64url'));
        u.searchParams.set("t", token);
        return u.toString();
    };

    const lines = text.split("\n");

    // --- 1. MASTER MANIFEST ---
    if (text.includes("#EXT-X-STREAM-INF")) {
        const outMaster: string[] = [];
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            // Proxy delle tracce Audio (fondamentale!)
            if (line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")) {
                const uriMatch = line.match(/URI=["']([^"']+)["']/);
                if (uriMatch) {
                    const absAudio = new URL(uriMatch[1], upstreamUrl).toString();
                    line = line.replace(uriMatch[1], toProxy(absAudio));
                }
                outMaster.push(line);
            }
            // Proxy delle varianti Video
            else if (!line.startsWith("#")) {
                outMaster.push(toProxy(new URL(line, upstreamUrl).toString()));
            } else {
                outMaster.push(line);
            }
        }
        return outMaster.join("\n");
    }

    // --- 2. MEDIA PLAYLIST (Standard Proxy) ---
    const outMedia: string[] = [];
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // Proxy delle Chiavi AES
        if (line.startsWith("#EXT-X-KEY:")) {
            const m = line.match(/URI=["']([^"']+)["']/);
            if (m) {
                const absKey = new URL(m[1], upstreamUrl).toString();
                line = line.replace(m[1], toProxy(absKey));
            }
            outMedia.push(line);
            continue;
        }

        // Proxy di tutti i segmenti (.ts), inclusi quelli pubblicitari
        if (!line.startsWith("#")) {
            try {
                outMedia.push(toProxy(new URL(line, upstreamUrl).toString()));
            } catch {
                outMedia.push(line);
            }
        } else {
            outMedia.push(line);
        }
    }

    //console.log(outMedia.join("\n"));
    return outMedia.join("\n");
}

async function handle(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const session = await readSessionFromKey(decodeURIComponent(key));
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const u = req.nextUrl.searchParams.get("u");
    const t = req.nextUrl.searchParams.get("t");
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    const tok: any = await unseal(t);
    if (!tok || tok.kind !== "pplus_proxy" || !tok.ls_session) {
        return new NextResponse("Bad token", { status: 401 });
    }

    let upstreamUrl: URL;
    try {
        upstreamUrl = new URL(Buffer.from(u, 'base64url').toString('utf-8'));
    } catch {
        return new NextResponse("Bad upstream url", { status: 400 });
    }

    const headers: Record<string, string> = {
        // niente cache: playlist live DAI cambia spesso
        "cache-control": "no-store",
        // UA realistico aiuta su alcune CDN
        "user-agent":
            req.headers.get("user-agent") ||
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
    };

    // Authorization/Cookie solo dove serve davvero
    if (needsParamountAuth(upstreamUrl.hostname)) {
        headers["authorization"] = `Bearer ${tok.ls_session}`;

        const cookie = buildCookieHeader(session.cookies);
        if (cookie) headers["cookie"] = cookie;

        headers["origin"] = "https://www.paramountplus.com";
        headers["referer"] = "https://www.paramountplus.com/";
    }

    const method = req.method === "HEAD" ? "HEAD" : "GET";

    const res = await fetch(upstreamUrl.toString(), {
        method,
        headers,
        redirect: "follow",
        cache: "no-store",
    });

    // HEAD: passthrough header (senza body)
    if (method === "HEAD") {
        const h = new Headers({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
        const ct = res.headers.get("content-type");
        if (ct) h.set("content-type", ct);
        const cc = res.headers.get("cache-control");
        if (cc) h.set("cache-control", cc);
        return new NextResponse(null, { status: res.status, headers: h });
    }

    const text = await res.text();
    const baseOrigin = guessBaseOrigin(req);

    const rewritten = rewriteM3U8({
        text,
        upstreamUrl,
        baseOrigin,
        key, // usa lo stesso key path-segment ricevuto (evita doppie encode)
        token: t,
    });

    const outHeaders = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.apple.mpegurl",
    });

    return new NextResponse(rewritten, { status: res.status, headers: outHeaders });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}
