// lib/paramount/sports.ts

import {ParamountClient, ParamountSession} from "@/lib/paramount/client";
import {StremioMeta} from "@/lib/stremio/types";
import {pplusLinearId, pplusSportId} from "@/lib/paramount/mapping";
import {msToDateTimeFormat, msToUtc, normImg} from "@/lib/paramount/utils";


function pickPoster(e: any): string | undefined {
    return (
        normImg(e?.filePathThumb) ??
        normImg(e?.filePathWideThumb) ??
        normImg(e?.channelLogo) ??
        normImg(e?.channelLogoDark)
    );
}

function pickBackground(e: any): string | undefined {
    return normImg(e?.filePathWideThumb) ?? normImg(e?.filePathThumb);
}

function pickLeagueLabel(e: any): string | undefined {
    const gd = e?.gameData;
    const a = gd?.competition ?? gd?.league ?? gd?.sport ?? gd?.leagueName ?? gd?.sportName;
    const b = gd?.tournament ?? gd?.competitionName;
    const out = [a, b].filter(Boolean).join(" • ");
    return out || undefined;
}

function pickManifestUrl(tokenResp: any): string | null {

    const candidates: (string | undefined)[] = [
        tokenResp?.streamingUrl,
        tokenResp?.hls?.url,
        tokenResp?.hlsUrl,
        tokenResp?.playback?.hls,
        tokenResp?.playback?.url,
        tokenResp?.manifestUrl,
    ];

    const allStrings: string[] = [];
    const walk = (obj: any) => {
        if (!obj) return;
        if (typeof obj === "string") allStrings.push(obj);
        else if (Array.isArray(obj)) obj.forEach(walk);
        else if (typeof obj === "object") Object.values(obj).forEach(walk);
    };
    walk(tokenResp);

    const merged = [...candidates.filter(Boolean) as string[], ...allStrings];
    const m3u8 = merged.find((u) => typeof u === "string" && u.includes(".m3u8"));
    if (m3u8) return m3u8;

    const license = merged.find((u) => typeof u === "string" && u.includes("/widevine/getlicense"));
    if (license) return null;

    return null;
}

function isLicenseUrl(u: string) {
    return u.includes("/widevine/getlicense") || u.toLowerCase().includes("getlicense");
}


/** Sport Events **/

export function mapSportListingToMeta(e: any) {
    const eventId = e?.id;
    const title = e?.title;
    if (!eventId || !title) return null;

    const startMs =
        typeof e.startTimestamp === "number" ? e.startTimestamp :
            typeof e.streamStartTimestamp === "number" ? e.streamStartTimestamp :
                undefined;

    const endMs =
        typeof e.endTimestamp === "number" ? e.endTimestamp :
            typeof e.streamEndTimestamp === "number" ? e.streamEndTimestamp :
                undefined;

    const channel = e?.channelName ?? e?.channelSlug ?? "";
    const league = pickLeagueLabel(e);
    const logo = normImg(e?.filePathLogo);

    const descParts: string[] = [];
    if (league) descParts.push(league);
    if (channel && channel !== league) descParts.push(`${channel}`);
    if (e?.isListingLive === true) descParts.push("LIVE");
    if (e?.description) descParts.push(String(e.description));

    return {
        id: `pplus:sport:${String(eventId)}`,
        type: "tv" as const,
        name: String(title),
        poster: pickPoster(e),
        logo: logo,
        posterShape: "landscape" as const,
        description: descParts.join(" • "),
        releaseInfo: msToUtc(startMs),
    } as StremioMeta;
}

export async function getSportListing(session: ParamountSession, id: string) : Promise<any>{
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
        if (id === "pplus_sports_live") {
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
    const listings: any[] = await getSportListing(session, 'pplus_sports_upcoming');
    return listings.find((x) => String(x?.id) === String(listingId)) ?? null;
}

export async function buildSportMeta(session: ParamountSession, listingId: string): Promise<StremioMeta | null> {
    const e = await findSportListing(session, listingId);
    if (!e) return null;

    const startMs =
        typeof e.streamStartTimestamp === "number" ? e.streamStartTimestamp :
            typeof e.startTimestamp === "number" ? e.startTimestamp :
                undefined;

    const endMs =
        typeof e.streamEndTimestamp === "number" ? e.streamEndTimestamp :
            typeof e.endTimestamp === "number" ? e.endTimestamp :
                undefined;

    const channel = e?.channelName ?? e?.channelSlug ?? "";
    const league = pickLeagueLabel(e);

    const descParts: string[] = [];
    if (league) descParts.push(league);
    if (channel && channel !== league) descParts.push(`${channel}`);
    if (e?.isListingLive === true) descParts.push("LIVE");
    if (startMs) descParts.push(`Start: ${msToDateTimeFormat(startMs)}`);
    if (endMs) descParts.push(`End: ${msToDateTimeFormat(endMs)}`);
    if (e?.description) descParts.push(String(e.description));

    const genres = [
        'Sport',
        'Paramount+'
    ];
    if(league) genres.push(league);

    return {
        id: pplusSportId(listingId),
        type: "tv",
        name: String(e.title ?? "Event"),
        poster: pickPoster(e),
        background: pickBackground(e),
        description: descParts.join(" • "),
        releaseInfo: msToUtc(startMs),
        genres: genres,
    };
}

export async function resolveSportStream(session: ParamountSession, listingId: string): Promise<{
    streamingUrl: string;
    streamingTitle: string;
    lsSession: string;
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

    if (!streamingUrl || !lsSession) return null;
    if (isLicenseUrl(streamingUrl)) return null;

    return { streamingUrl, streamingTitle, lsSession, videoContentId: String(videoContentId) };
}


/** Linear Channels **/

export async function buildLinearMeta(session: ParamountSession, slug: string): Promise<StremioMeta> {
    const client = new ParamountClient();
    await client.setSession(session);
    const data = await client.getLiveChannelListings(slug);

    const listing = (data?.listing ?? data?.listings ?? [])[0] ?? null;

    const channelName =
        slug === "cbssportshq" ? "CBS Sports HQ" :
            slug === "golazo" ? "GOLAZO Network" :
                slug;

    const channelLogo =
        slug === "cbssportshq" ? "https://shop.cbssports.com/_next/image?url=https%3A%2F%2Fs3.us-west-2.amazonaws.com%2Fprod-cbssportstenantstack-citadelbucket0907d78c-qwwjcczd8p3p%2Fcbs-sports-hq-logo-1737694205760.png&w=1080&q=75" :
            slug === "golazo" ? "https://shop.cbssports.com/_next/image?url=https%3A%2F%2Fs3.us-west-2.amazonaws.com%2Fprod-cbssportstenantstack-citadelbucket0907d78c-qwwjcczd8p3p%2Fgolazo_hero_logo-1730491850882.webp&w=1080&q=75" :
                "";

    if (!listing) {
        return {
            id: pplusLinearId(slug),
            type: "tv",
            name: channelName,
            description: "No current listing available",
        };
    }

    const title = listing?.episodeTitle || listing?.title || channelName;

    const startMs = typeof listing.startTimestamp === "number" ? listing.startTimestamp : undefined;
    const endMs = typeof listing.endTimestamp === "number" ? listing.endTimestamp : undefined;

    const descParts: string[] = [];
    descParts.push(`${channelName}`);
    descParts.push(`${title}`);
    descParts.push("LIVE");
    if (startMs) descParts.push(`Start: ${msToDateTimeFormat(startMs)}`);
    if (endMs) descParts.push(`End: ${msToDateTimeFormat(endMs)}`);

    const genres = [
        'Sport',
        'Paramount+'
    ];

    return {
        id: pplusLinearId(slug),
        type: "tv",
        name: `${channelName} — ${title}`,
        logo: channelLogo,
        poster: pickPoster(listing) ?? undefined,
        background: pickBackground(listing) ?? undefined,
        description: descParts.join(" • "),
        releaseInfo: msToUtc(startMs),
        genres: genres,
    };
}

export async function resolveLinearStream(session: ParamountSession, slug: string): Promise<{
    streamingUrl: string;
    streamingTitle: string;
    lsSession: string;
    videoContentId: string;
} | null> {
    const client = new ParamountClient();
    await client.setSession(session);

    const data = await client.getLiveChannelListings(slug);
    const listing = (data?.listing ?? data?.listings ?? [])[0] ?? null;
    if (!listing?.videoContentId) return null;

    const channelName =
        slug === "cbssportshq" ? "CBS Sports HQ" :
            slug === "golazo" ? "GOLAZO Network" :
                slug;
    const title = listing?.episodeTitle || listing?.title

    const tokenResp = await client.getIrdetoSessionToken(String(listing.videoContentId));
    const streamingUrl = pickManifestUrl(tokenResp);
    const streamingTitle = `📺 ${channelName} \n📹 ${title}`;
    const lsSession = tokenResp?.ls_session;


    if (!streamingUrl || !lsSession) return null;
    if (isLicenseUrl(streamingUrl)) return null;

    return { streamingUrl, streamingTitle, lsSession, videoContentId: String(listing.videoContentId) };
}
