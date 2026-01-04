import { NextRequest, NextResponse } from "next/server";
import { readSessionFromKey } from "@/lib/auth/session";
import { parsePplusId } from "@/lib/paramount/mapping";
import { resolveSportStream, resolveLinearStream } from "@/lib/paramount/sports";
import { seal } from "@/lib/auth/jwe";
import { buildMfpHlsUrl, getProxyMode, wrapUrlWithMediaFlow } from "@/lib/mediaflowproxy/mediaflowproxy";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

function stripJsonSuffix(s: string) {
    return s.endsWith(".json") ? s.slice(0, -5) : s;
}

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ key: string; type: string; id?: string[] }> }
) {
    const { key, type, id } = await ctx.params;

    const session = await readSessionFromKey(decodeURIComponent(key));
    if (!session) return NextResponse.json({ streams: [] }, { status: 200 });

    //const raw = (id?.join("/") ?? "");
    const cleaned = stripJsonSuffix(String(id));
    const decoded = decodeURIComponent(cleaned);

    if (type !== "tv") return NextResponse.json({ streams: [] }, { status: 200 });

    const parsed = parsePplusId(decoded);

    let streamData = null;

    if (parsed.kind === "sport") {
        streamData = await resolveSportStream(session, parsed.key);
    } else if (parsed.kind === "linear") {
        streamData = await resolveLinearStream(session, parsed.key);
    }

    if (!streamData) return NextResponse.json({ streams: [] }, { status: 200 });

    // Token per proxy: contiene ls_session + scadenza breve
    // @ts-ignore
    const proxyToken = await seal({
        kind: "pplus_proxy",
        ls_session: streamData.ls_session,
        exp: Date.now() + 120 * 60 * 1000, // 30 min
    });

    const lsSession = streamData.ls_session;
    const streamingUrl = new URL(streamData.streamingUrl);
    const streams = [];

    // Proxy playlist endpoint
    if(streamingUrl) {
        const url = process.env.BASE_URL || req.url || "http://localhost:3000";
        const base = new URL(url);

        const streamlink = new URL(`/api/stremio/${encodeURIComponent(key)}/proxy/stream`, base.origin);
        streamlink.searchParams.set("u", Buffer.from(streamingUrl.toString()).toString('base64url'));
        streamlink.searchParams.set("t", proxyToken);

        if (streamlink) {
            console.log("streamlink: ", streamlink.toString());
            streams.push({
                name: "Paramount+ Sports",
                title: "MPEG-TS (Internal Proxy + Remuxing)",
                url: streamlink.toString(),
                isLive: true,
                notWebReady: true
            });
        }

        const internal = new URL(`/api/stremio/${encodeURIComponent(key)}/proxy/hls`, base.origin);
        internal.searchParams.set("u", Buffer.from(streamingUrl.toString()).toString('base64url'));
        internal.searchParams.set("t", proxyToken);

        if (internal) {
            console.log("internal: ", internal.toString());
            streams.push({
                name: "Paramount+ Sports",
                title: "HLS (Internal Proxy)",
                url: internal.toString(),
                isLive: true,
                notWebReady: true
            });
        }

        if (process.env.MFP_URL) {
            let external = wrapUrlWithMediaFlow(streamingUrl, session, lsSession, true);
            console.log("external: ", external?.toString());
            streams.push({
                name: "Paramount+ Sports",
                title: "MPEG-TS (MFP Proxy + Remuxing)",
                url: external?.toString(),
                isLive: true,
                notWebReady: true
            });
            external = wrapUrlWithMediaFlow(streamingUrl, session, lsSession, false);
            streams.push({
                name: "Paramount+ Sports",
                title: "HLS (MFP Proxy)",
                url: external?.toString(),
                isLive: true,
                notWebReady: true
            });
        }
    }

    return NextResponse.json({streams}, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
}
