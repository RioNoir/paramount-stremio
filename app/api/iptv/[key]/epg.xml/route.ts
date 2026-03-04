import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { getLiveListing } from "@/lib/paramount/types/live";
import { getSportListing } from "@/lib/paramount/types/sports";
import {
    IptvChannel,
    mapLiveChannel,
    mapSportChannel,
    tvgId,
    tvgSportId,
    xmlEscape,
    xmlTvDate
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

    const now = Date.now();
    const maxDays = 3;
    const endWindow = now + maxDays * 24 * 60 * 60 * 1000;

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

    const out: string[] = [];
    out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    out.push(`<tv generator-info-name="paramount-stremio">`);

    for (const channel of channels) {
        const id = channel.source === "sport" ? tvgSportId(channel.slug) : tvgId(channel.slug);
        out.push(`<channel id="${xmlEscape(id)}">`);
        out.push(`<display-name>${xmlEscape(channel.name)}</display-name>`);
        if (channel.logo) out.push(`<icon src="${xmlEscape(channel.logo)}" />`);
        out.push(`</channel>`);
    }

    for (const channel of channels) {
        const id = channel.source === "sport" ? tvgSportId(channel.slug) : tvgId(channel.slug);
        for (const program of channel.programs) {
            const start = Number(program.startTimestamp);
            const stop = Number(program.endTimestamp);
            if (!start || !stop || stop <= start) continue;
            if (stop < now || start > endWindow) continue;

            const startXml = xmlTvDate(start);
            const stopXml = xmlTvDate(stop);
            if (!startXml || !stopXml) continue;

            out.push(
                `<programme start="${startXml}" stop="${stopXml}" channel="${xmlEscape(id)}">`
            );
            out.push(`<title lang="en">${xmlEscape(String(program.title ?? channel.name))}</title>`);
            if (program.description) {
                out.push(`<desc lang="en">${xmlEscape(String(program.description))}</desc>`);
            }
            if (typeof program.filePathThumb === "string" && program.filePathThumb.length > 0) {
                out.push(`<icon src="${xmlEscape(program.filePathThumb)}" />`);
            }
            out.push(`</programme>`);
        }
    }

    out.push(`</tv>`);

    return new NextResponse(out.join("\n") + "\n", {
        status: 200,
        headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
            "Access-Control-Allow-Origin": "*",
        },
    });
}
