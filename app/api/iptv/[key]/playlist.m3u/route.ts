import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { getLiveListing } from "@/lib/paramount/types/live";
import { getSportListing } from "@/lib/paramount/types/sports";
import {
    IptvChannel,
    m3uAttrEscape,
    mapLiveChannel,
    mapSportChannel,
    tvgId,
    tvgSportId
} from "@/lib/paramount/iptv";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ key: string }> }
) {
    const { key } = await ctx.params;
    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) {
        return new NextResponse("Invalid session", { status: 401 });
    }

    const base = new URL(process.env.BASE_URL || req.url || "http://localhost:3000");
    const epgUrl = new URL(`/api/iptv/${encodeURIComponent(key)}/epg.xml`, base.origin).toString();

    const rawLiveChannels = await getLiveListing(session);
    const liveChannels = rawLiveChannels
        .map(mapLiveChannel)
        .filter((item: IptvChannel | null): item is IptvChannel => Boolean(item))
        .sort((a: IptvChannel, b: IptvChannel) => a.name.localeCompare(b.name));
    const rawSports = await getSportListing(session, false);
    const sportChannels = rawSports
        .map(mapSportChannel)
        .filter((item: IptvChannel | null): item is IptvChannel => Boolean(item))
        .sort((a: IptvChannel, b: IptvChannel) => a.name.localeCompare(b.name));
    const channels = [...liveChannels, ...sportChannels];

    const lines: string[] = [`#EXTM3U url-tvg="${epgUrl}"`];

    for (const channel of channels) {
        const streamPath = channel.source === "sport"
            ? `/api/iptv/${encodeURIComponent(key)}/sport/${encodeURIComponent(channel.slug)}`
            : `/api/iptv/${encodeURIComponent(key)}/live/${encodeURIComponent(channel.slug)}`;
        const streamUrl = new URL(streamPath, base.origin).toString();
        const name = m3uAttrEscape(channel.name);
        const group = m3uAttrEscape(channel.group ?? "Live");
        const logo = m3uAttrEscape(channel.logo ?? "");
        const id = m3uAttrEscape(
            channel.source === "sport" ? tvgSportId(channel.slug) : tvgId(channel.slug)
        );

        lines.push(
            `#EXTINF:-1 tvg-id="${id}" tvg-name="${name}" tvg-logo="${logo}" group-title="${group}",${name}`
        );
        lines.push(streamUrl);
    }

    return new NextResponse(lines.join("\n") + "\n", {
        status: 200,
        headers: {
            "Content-Type": "application/x-mpegURL; charset=utf-8",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
            "Access-Control-Allow-Origin": "*",
        },
    });
}
