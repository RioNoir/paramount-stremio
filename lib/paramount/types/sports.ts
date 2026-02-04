import {ParamountClient, ParamountSession} from "@/lib/paramount/client";
import {StremioMeta} from "@/lib/stremio/types";
import {pplusSportId} from "@/lib/paramount/mapping";
import {msToDateTimeFormat, msToUtc, normImg, pickPoster, pickLeagueLabel, pickManifestUrl, isLicenseUrl} from "@/lib/paramount/utils";

export function mapSportListingToMeta(e: any) {
    const eventId = e?.id;
    const title = e?.title;
    if (!eventId || !title) return null;

    const startMs =
        typeof e.streamStartTimestamp === "number" ? e.streamStartTimestamp :
            typeof e.startTimestamp === "number" ? e.startTimestamp :
                undefined;

    const endMs =
        typeof e.streamEndTimestamp === "number" ? e.streamEndTimestamp :
            typeof e.endTimestamp === "number" ? e.endTimestamp :
                undefined;

    const channel = e?.channelName ?? e?.channelSlug ?? "";
    const poster = pickPoster(e);
    const league = pickLeagueLabel(e);
    const logo = normImg(e?.filePathLogo);

    const descParts: string[] = [];
    if (league) descParts.push(league);
    if (channel && channel !== league) descParts.push(`${channel}`);
    if (e?.isListingLive === true) descParts.push("LIVE");
    if (startMs) descParts.push(`Start: ${msToDateTimeFormat(startMs)}`);
    if (endMs) descParts.push(`End: ${msToDateTimeFormat(endMs)}`);
    if (e?.description) descParts.push(String(e.description));

    const genres = [
        'Paramount+',
        'Sport',
    ];
    if(league) genres.push(league);

    return {
        id: pplusSportId(eventId),
        type: "tv",
        name: String(title),
        poster: poster,
        background: poster,
        logo: logo,
        posterShape: "landscape" as const,
        description: descParts.join(" • "),
        releaseInfo: msToUtc(startMs),
        genres: genres,
    } as StremioMeta;
}

export async function getSportListing(session: ParamountSession, onlyLive: boolean) : Promise<any>{
    const client = new ParamountClient();
    await client.setSession(session);
    const data : any = await client.getSportsLiveUpcoming();

    const listings: any[] =
        data?.listings ??
        data?.data?.listings ??
        data?.data?.data?.listings ??
        [];

    const now = Date.now();
    return listings.filter((e) => {
        const isLive = e?.isListingLive === true;
        const startMs =
            typeof e.startTimestamp === "number" ? e.startTimestamp :
                typeof e.streamStartTimestamp === "number" ? e.streamStartTimestamp :
                    undefined;
        if (!startMs) return false;
        if (onlyLive) {
            const endMs =
                typeof e.endTimestamp === "number" ? e.endTimestamp :
                    typeof e.streamEndTimestamp === "number" ? e.streamEndTimestamp :
                        undefined;

            if (isLive) return true;
            if (endMs && startMs <= now && now < endMs) return true;
            return false;
        } else {
            return true;
        }
    });
}

export async function findSportListing(session: ParamountSession, listingId: string) {
    const listings: any[] = await getSportListing(session, false);
    return listings.find((x) => String(x?.id) === String(listingId)) ?? null;
}

export async function buildSportMeta(session: ParamountSession, listingId: string): Promise<StremioMeta> {
    const e = await findSportListing(session, listingId);
    return mapSportListingToMeta(e) as StremioMeta;
}

export async function resolveSportStream(session: ParamountSession, listingId: string): Promise<{
    streamingUrl: string;
    streamingTitle: string;
    lsSession: string;
    lsUrl: string|undefined;
    videoContentId: string;
} | null> {
    const e = await findSportListing(session, listingId);
    if (!e) return null;

    const videoContentId = e?.videoContentId;
    if (!videoContentId) return null;

    const client = new ParamountClient();
    await client.setSession(session);
    const tokenResp = await client.getIrdetoSessionToken(String(videoContentId));

    const streamingUrl = pickManifestUrl(tokenResp);
    const streamingTitle = `📺 ${String(e.title ?? "Event")}`;
    const lsSession = tokenResp?.ls_session;
    const lsUrl = tokenResp?.url;

    if (!streamingUrl || !lsSession) return null;
    if (isLicenseUrl(streamingUrl)) return null;

    return { streamingUrl, streamingTitle, lsSession, lsUrl, videoContentId: String(videoContentId) };
}
