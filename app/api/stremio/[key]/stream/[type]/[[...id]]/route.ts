
import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { parsePplusId } from "@/lib/paramount/mapping";
import {
    buildCookieHeader,
    needsParamountAuth,
    PPLUS_BASE_URL,
    PPLUS_HEADER,
    stripJsonSuffix
} from "@/lib/paramount/utils";
import { resolveSportStream } from "@/lib/paramount/types/sports";
import { resolveLiveStream } from "@/lib/paramount/types/live";
import { wrapUrlWithMediaFlow } from "@/lib/mediaflowproxy/mediaflowproxy";
import { shorten } from "@/lib/http/sid";
import {httpClient} from "@/lib/http/client";
import {splitMasterPlaylist} from "@/lib/paramount/proxy/hls"

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
    } else if (parsed.kind === "live") {
        streamData = await resolveLiveStream(session, parsed.key);
    }
    if (!streamData) return NextResponse.json({ streams: [] }, { status: 200 });

    const lsUrl = streamData.lsUrl ?? "";
    const lsSession = streamData.lsSession;
    const streamingUrl = new URL(streamData.streamingUrl);
    const streamingTitle = streamData.streamingTitle;
    const streams = [];

    const headers: Record<string, string> = {
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        "user-agent": await PPLUS_HEADER(),
    };
    if (needsParamountAuth(streamingUrl.hostname)) {
        headers["authorization"] = `Bearer ${lsSession}`;
        const cookie = buildCookieHeader(session.cookies);
        if (cookie) headers["cookie"] = cookie;
        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    // Proxy playlist endpoint
    if(streamingUrl) {
        const url = process.env.BASE_URL || req.url || "http://localhost:3000";
        const base = new URL(url);

        if(streamingUrl.toString().includes('.m3u8')) {

            //HLS internal proxy stream
            const internal = new URL(`/api/stremio/${encodeURIComponent(key)}/proxy/hls`, base.origin);
            internal.searchParams.set("u", Buffer.from(streamingUrl.toString()).toString('base64url'));
            internal.searchParams.set("t", Buffer.from(lsSession.toString()).toString('base64url'));
            if (internal) {
                streams.push({
                    name: "Paramount+",
                    title: `${streamingTitle} \n🎞 HLS (Auto quality)`,
                    url: internal.toString(),
                    isLive: true,
                    notWebReady: false
                });
            }

            headers['accept'] = "application/vnd.apple.mpegurl, application/x-mpegURL, */*";
            const {status, data} = await httpClient.get(streamingUrl.toString(), {
                headers: headers
            });
            if(status == 200) {
                const playlists = splitMasterPlaylist(data.toString());
                playlists.forEach(stream => {
                    internal.searchParams.set("b", stream.bandwidth);
                    if (internal) {
                        streams.push({
                            name: "Paramount+",
                            title: `${streamingTitle} \n🎞 HLS (${stream.quality})`,
                            url: internal.toString(),
                            isLive: true,
                            notWebReady: false
                        });
                    }
                });
            }

            if (process.env.MFP_URL) {
                let external = await wrapUrlWithMediaFlow(streamingUrl, session, lsSession, true);
                streams.push({
                    name: "Paramount+",
                    title: `${streamingTitle} \n🎞 MPEG-TS (MFP Proxy)`,
                    url: external?.toString(),
                    isLive: true,
                    notWebReady: false
                });
                external = await wrapUrlWithMediaFlow(streamingUrl, session, lsSession, false);
                streams.push({
                    name: "Paramount+",
                    title: `${streamingTitle} \n🎞 HLS (MFP Proxy)`,
                    url: external?.toString(),
                    isLive: true,
                    notWebReady: false
                });
            }

        }else if(streamingUrl.toString().includes('.mpd')){
            //MPD internal proxy stream
            const sid = shorten(key, streamingUrl.toString(), lsSession.toString(), lsUrl.toString());
            const internal = new URL(`/api/proxy/${sid}/mpd`, base.origin);
            const license = new URL(`/api/proxy/${sid}/license`, base.origin);

            if (internal) {
                streams.push({
                    name: "Paramount+",
                    title: `${streamingTitle} \n🎞 MPD`,
                    url: internal.toString(),
                    isLive: true,
                    notWebReady: true,
                    behaviorHints: {
                        configuration: {
                            drm: {
                                widevine: {
                                    licenseUrl: license.toString()
                                }
                            }
                        }
                    }
                });
            }
        }
    }

    return NextResponse.json({streams}, { status: 200, headers: {
        "Allow": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        "Content-Type": "application/json",
    } });
}
