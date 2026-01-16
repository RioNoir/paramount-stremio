
import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { parsePplusId } from "@/lib/paramount/mapping";
import { stripJsonSuffix } from "@/lib/paramount/utils";
import { resolveSportStream, resolveLinearStream } from "@/lib/paramount/types/sports";
import { wrapUrlWithMediaFlow } from "@/lib/mediaflowproxy/mediaflowproxy";
import { seal } from "@/lib/auth/jwe";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ key: string; type: string; id?: string[] }> }
) {
    const { key, type, id } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return NextResponse.json({ streams: [] }, { status: 200 });

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


    const lsSession = streamData.lsSession;
    const streamingUrl = new URL(streamData.streamingUrl);
    const streamingTitle = streamData.streamingTitle;
    const streams = [];

    // Proxy playlist endpoint
    if(streamingUrl) {
        const url = process.env.BASE_URL || req.url || "http://localhost:3000";
        const base = new URL(url);

        //HLS internal proxy stream
        const internal = new URL(`/api/stremio/${encodeURIComponent(key)}/proxy/hls`, base.origin);
        internal.searchParams.set("u", Buffer.from(streamingUrl.toString()).toString('base64url'));
        internal.searchParams.set("t", Buffer.from(lsSession.toString()).toString('base64url'));
        if (internal) {
            streams.push({
                name: "Paramount+ (US)",
                title: `${streamingTitle} \n🎞 HLS`,
                url: internal.toString(),
                isLive: true,
                notWebReady: true
            });
        }

        if (process.env.MFP_URL) {
            let external = wrapUrlWithMediaFlow(streamingUrl, session, lsSession, true);
            streams.push({
                name: "Paramount+ (US)",
                title: `${streamingTitle} \n🎞 MPEG-TS (MFP Proxy)`,
                url: external?.toString(),
                isLive: true,
                notWebReady: true
            });
            external = wrapUrlWithMediaFlow(streamingUrl, session, lsSession, false);
            streams.push({
                name: "Paramount+ (US)",
                title: `${streamingTitle} \n🎞 HLS (MFP Proxy)`,
                url: external?.toString(),
                isLive: true,
                notWebReady: true
            });
        }
    }

    return NextResponse.json({streams}, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
}
