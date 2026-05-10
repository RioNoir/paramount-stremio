
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
import {splitMasterPlaylist, splitAudioTracks} from "@/lib/paramount/proxy/hls"

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
        const baseUrl = process.env.BASE_URL?.replace(/\/$/, '') ?? new URL(req.url).origin;

        if(streamingUrl.toString().includes('.m3u8')) {

            // Base proxy URL (immutable reference — clone per variante)
            const proxyBase = new URL(`${baseUrl}/api/stremio/${encodeURIComponent(key)}/proxy/hls`);
            proxyBase.searchParams.set("u", Buffer.from(streamingUrl.toString()).toString('base64url'));
            proxyBase.searchParams.set("t", Buffer.from(lsSession.toString()).toString('base64url'));

            // Auto quality stream
            streams.push({
                name: "Paramount+",
                title: `${streamingTitle} \n🗣️ Auto \n🎞 HLS (Auto quality)`,
                url: proxyBase.toString(),
                isLive: true,
                notWebReady: false
            });

            headers['accept'] = "application/vnd.apple.mpegurl, application/x-mpegURL, */*";
            const {status, data} = await httpClient.get(streamingUrl.toString(), {
                headers: headers
            });
            if(status == 200) {
                const masterM3u8 = data.toString();
                const audioTracks = splitAudioTracks(masterM3u8);
                const multiLang = audioTracks.length >= 2;

                // Per-language Auto quality streams
                if (multiLang) {
                    for (const track of audioTracks) {
                        const lUrl = new URL(proxyBase.toString());
                        lUrl.searchParams.set("lang", track.language);
                        streams.push({
                            name: "Paramount+",
                            title: `${streamingTitle} \n🗣️ ${track.name} \n🎞 HLS (Auto quality)`,
                            url: lUrl.toString(),
                            isLive: true,
                            notWebReady: false
                        });
                    }
                }

                // Quality-specific streams
                for (const variant of splitMasterPlaylist(masterM3u8)) {
                    const qUrl = new URL(proxyBase.toString());
                    qUrl.searchParams.set("b", String(variant.bandwidth));
                    streams.push({
                        name: "Paramount+",
                        title: `${streamingTitle} \n🗣️ Auto \n🎞 HLS (${variant.quality})`,
                        url: qUrl.toString(),
                        isLive: true,
                        notWebReady: false
                    });

                    // Per-language quality streams
                    if (multiLang) {
                        for (const track of audioTracks) {
                            const lUrl = new URL(proxyBase.toString());
                            lUrl.searchParams.set("b", String(variant.bandwidth));
                            lUrl.searchParams.set("lang", track.language);
                            streams.push({
                                name: "Paramount+",
                                title: `${streamingTitle} \n🗣️ ${track.name} \n🎞 HLS (${variant.quality})`,
                                url: lUrl.toString(),
                                isLive: true,
                                notWebReady: false
                            });
                        }
                    }
                }
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
            const internal = new URL(`${baseUrl}/api/proxy/${sid}/mpd`);
            const license = new URL(`${baseUrl}/api/proxy/${sid}/license`);

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
