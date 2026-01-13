import { NextRequest, NextResponse } from "next/server";
import { readSessionFromKey } from "@/lib/auth/session";
import { unseal } from "@/lib/auth/jwe";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function needsParamountAuth(hostname: string) {
    const h = hostname.toLowerCase();
    //return h.endsWith("cbsi.live.ott.irdeto.com") || h.endsWith("paramountplus.com") || h.endsWith("cbsivideo.com");
    return !h.endsWith("google.com");
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
        const headerLines: string[] = [];
        const streamInfVariants: { bandwidth: number; info: string; url: string }[] = [];
        const frameStreamInfVariants: { bandwidth: number; info: string;}[] = [];
        const footerLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith("#EXT-X-STREAM-INF")) {
                // Estrae la bandwidth per l'ordinamento
                const bwMatch = line.match(/BANDWIDTH=(\d+)/);
                const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;

                // La riga successiva è l'URL della variante
                const nextLine = lines[i + 1]?.trim();
                if (nextLine && !nextLine.startsWith("#")) {
                    streamInfVariants.push({
                        bandwidth,
                        info: line,
                        url: toProxy(new URL(nextLine, upstreamUrl).toString())
                    });
                    i++; // Salta la riga dell'URL nel ciclo principale
                }
            } else if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF")) {
                // Estrae la bandwidth per l'ordinamento
                const bwMatch = line.match(/BANDWIDTH=(\d+)/);
                const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;

                const uriMatch = line.match(/URI=["']([^"']+)["']/);
                if (uriMatch) {
                    const absUri = new URL(uriMatch[1], upstreamUrl).toString();
                    line = line.replace(uriMatch[1], toProxy(absUri));
                }

                frameStreamInfVariants.push({
                    bandwidth,
                    info: line
                });
            } else if (line.startsWith("#EXT")) {
                const uriMatch = line.match(/URI=["']([^"']+)["']/);
                if (uriMatch) {
                    const absUri = new URL(uriMatch[1], upstreamUrl).toString();
                    line = line.replace(uriMatch[1], toProxy(absUri));
                }
                headerLines.push(line);
            }
        }

        // --- ORDINAMENTO ---
        // Ordina dalla bandwidth più alta alla più bassa
        streamInfVariants.sort((a, b) => b.bandwidth - a.bandwidth);
        frameStreamInfVariants.sort((a, b) => b.bandwidth - a.bandwidth);

        // Ricostruisce il file
        const outMaster = [...headerLines];
        streamInfVariants.forEach(v => {
            outMaster.push(v.info);
            outMaster.push(v.url);
        });
        frameStreamInfVariants.forEach(v => {
            outMaster.push(v.info);
        });
        outMaster.push(...footerLines);

        return outMaster.join("\n");
    }

    // --- 2. MEDIA PLAYLIST (Rimane invariata) ---
    const outMedia: string[] = [];
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.startsWith("#EXT")) {
            const m = line.match(/URI=["']([^"']+)["']/);
            if (m) {
                const absKey = new URL(m[1], upstreamUrl).toString();
                line = line.replace(m[1], toProxy(absKey));
            }
            outMedia.push(line);
            continue;
        }

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
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        // UA realistico aiuta su alcune CDN
        "user-agent": "AppleTV6,2/11.1",
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
        const h = new Headers({
            "Allow": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate"
        });
        const ct = res.headers.get("content-type");
        if (ct) h.set("Content-Type", ct);
        const cc = res.headers.get("cache-control");
        if (cc) h.set("Cache-Control", cc);
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
        "Allow": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        "Content-Type": "application/vnd.apple.mpegurl",
        //"Content-Type": "text/plain",
    });

    return new NextResponse(rewritten, { status: res.status, headers: outHeaders });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}
