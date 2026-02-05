import { NextRequest, NextResponse } from "next/server";
import {ParamountClient} from "@/lib/paramount/client";
import {needsParamountAuth, buildCookieHeader, guessBaseOrigin, PPLUS_BASE_URL, PPLUS_HEADER} from "@/lib/paramount/utils";
import {httpClient} from "@/lib/http/client";
import { shorten, extend } from "@/lib/http/sid";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function rewriteM3U8(params: {
    text: string;
    upstreamUrl: URL;
    upstreamToken: string;
    baseOrigin: string;
    key: string;
}) {
    const { text, upstreamUrl, upstreamToken, baseOrigin, key } = params;

    const toProxy = (absUrl: string) => {
        const isManifest = absUrl.includes(".m3u8");
        const endpoint = isManifest ? "hls" : "seg";
        const sid = shorten(key, absUrl.toString(), upstreamToken);
        const u = new URL(`/api/proxy/${sid}/${endpoint}`, baseOrigin);
        return u.toString();
    };

    const lines = text.split("\n");

    // --- MASTER MANIFEST ---
    if (text.includes("#EXT-X-STREAM-INF")) {
        const headerLines: string[] = [];
        const streamInfVariants: { bandwidth: number; info: string; url: string }[] = [];
        const frameStreamInfVariants: { bandwidth: number; info: string;}[] = [];
        const footerLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith("#EXT-X-STREAM-INF")) {
                const bwMatch = line.match(/BANDWIDTH=(\d+)/);
                const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;

                const nextLine = lines[i + 1]?.trim();
                if (nextLine && !nextLine.startsWith("#")) {
                    streamInfVariants.push({
                        bandwidth,
                        info: line,
                        url: toProxy(new URL(nextLine, upstreamUrl).toString())
                    });
                    i++;
                }
            } else if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF")) {
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

        const forceHq = process.env.FORCE_HQ || false;
        if(forceHq) {
            streamInfVariants.sort((a, b) => b.bandwidth - a.bandwidth);
            frameStreamInfVariants.sort((a, b) => b.bandwidth - a.bandwidth);
        }

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

    // --- MEDIA PLAYLIST ---
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

async function handle(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
    const { sid } = await ctx.params;

    const session = sid ? extend(sid) : null;
    const key = session?.key ?? null;
    const u = session?.u ?? null;
    const t = session?.t ?? null;
    if (!session || !key) {
        return new Response("Invalid Session", { status: 403 });
    }
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const pSession = client.getSession();
    if (!pSession) return new NextResponse("Unauthorized", { status: 401 });

    const upstreamUrl = new URL(u);
    const upstreamToken = t;

    const headers: Record<string, string> = {
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        "user-agent": await PPLUS_HEADER(),
        accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
    };

    if (needsParamountAuth(upstreamUrl.hostname)) {
        headers["authorization"] = `Bearer ${upstreamToken}`;

        const cookie = buildCookieHeader(pSession.cookies);
        if (cookie) headers["cookie"] = cookie;

        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const {status, data} = await httpClient.get(upstreamUrl.toString(), {
        headers: headers
    });

    if (req.method === "HEAD") {
        const h = new Headers({
            "Allow": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
            "Content-Type": "application/vnd.apple.mpegurl",
        });
        return new NextResponse(null, { status: status, headers: h });
    }

    const baseOrigin = guessBaseOrigin(req);
    const text = data.toString();
    const rewritten = rewriteM3U8({
        text,
        upstreamUrl,
        upstreamToken,
        baseOrigin,
        key,
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

    return new NextResponse(rewritten, { status: status, headers: outHeaders });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}
