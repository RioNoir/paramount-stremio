// lib/paramount/sports.ts

import type { ParamountSession } from "@/lib/auth/session";
import { ParamountContentApi } from "@/lib/paramount/content";
import { normImg, pplusSportId, pplusLinearId } from "@/lib/paramount/mapping";

export type StremioMeta = {
    id: string;
    type: "tv";
    name: string;
    poster?: string;
    background?: string;
    description?: string;
    releaseInfo?: string;
    genres?: string[];
};

function fmtUtc(ms?: number): string | undefined {
    if (!ms || !Number.isFinite(ms)) return undefined;
    const iso = new Date(ms).toISOString();
    return iso.slice(0, 16).replace("T", " ") + " UTC";
}

function pickPoster(e: any): string | undefined {
    return (
        normImg(e?.filepathFallbackImage) ??
        normImg(e?.channelLogo) ??
        normImg(e?.filePathThumb) ??
        normImg(e?.filePathWideThumb) ??
        normImg(e?.channelLogoDark)
    );
}

function pickBackground(e: any): string | undefined {
    return normImg(e?.filePathWideThumb) ?? normImg(e?.filePathThumb);
}

function leagueLabel(e: any): string | undefined {
    const gd = e?.gameData;
    const a = gd?.competition ?? gd?.league ?? gd?.sport ?? gd?.leagueName ?? gd?.sportName;
    const b = gd?.tournament ?? gd?.competitionName;
    const out = [a, b].filter(Boolean).join(" • ");
    return out || undefined;
}

export async function findSportListing(session: ParamountSession, listingId: string) {
    const api = new ParamountContentApi();
    const data = await api.sportsLiveUpcoming(session.cookies);

    // shape: data.listings in EPlusTV :contentReference[oaicite:4]{index=4}
    // il tuo dump potrebbe avere wrapper diverso; quindi fallback multipli
    const listings: any[] =
        data?.listings ??
        data?.data?.listings ??
        data?.data?.data?.listings ??
        [];

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
    const league = leagueLabel(e);

    const descParts: string[] = [];
    if (league) descParts.push(league);
    if (channel) descParts.push(`Channel: ${channel}`);
    if (e?.isListingLive === true) descParts.push("LIVE");
    if (startMs) descParts.push(`Start: ${fmtUtc(startMs)}`);
    if (endMs) descParts.push(`End: ${fmtUtc(endMs)}`);
    if (e?.description) descParts.push(String(e.description));

    return {
        id: pplusSportId(listingId),
        type: "tv",
        name: String(e.title ?? "Event"),
        poster: pickPoster(e),
        background: pickBackground(e),
        description: descParts.join(" • "),
        releaseInfo: fmtUtc(startMs),
        genres: league ? [league] : undefined,
    };
}


/**
 * META per canale lineare (CBS Sports HQ / Golazo):
 * prende il "now playing" da live/channels/{slug}/listings.json :contentReference[oaicite:3]{index=3}
 */
export async function buildLinearMeta(session: ParamountSession, slug: string): Promise<StremioMeta> {
    const api = new ParamountContentApi();
    const data = await api.liveChannelListings(session.cookies, slug);

    const listing = (data?.listing ?? data?.listings ?? [])[0] ?? null;

    const channelName =
        slug === "cbssportshq" ? "CBS Sports HQ" :
            slug === "golazo" ? "GOLAZO Network" :
                slug;

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
    descParts.push(`Channel: ${channelName}`);
    descParts.push("LIVE");
    if (startMs) descParts.push(`Start: ${fmtUtc(startMs)}`);
    if (endMs) descParts.push(`End: ${fmtUtc(endMs)}`);

    return {
        id: pplusLinearId(slug),
        type: "tv",
        name: `${channelName} — ${title}`,
        poster: pickPoster(listing) ?? undefined,
        background: pickBackground(listing) ?? undefined,
        description: descParts.join(" • "),
        releaseInfo: fmtUtc(startMs),
    };
}

export async function resolveSportStream(session: ParamountSession, listingId: string): Promise<{
    streamingUrl: string;
    ls_session: string;
    videoContentId: string;
} | null> {
    const e = await findSportListing(session, listingId);
    if (!e) return null;

    const videoContentId = e?.videoContentId;
    if (!videoContentId) return null;

    const api = new ParamountContentApi();
    const data = await api.irdetoSessionToken(session.cookies, String(videoContentId));

    // EPlusTV richiede streamingUrl + ls_session :contentReference[oaicite:5]{index=5}
    const streamingUrl = data?.url;
    const ls_session = data?.ls_session;

    if (!streamingUrl || !ls_session) return null;

    return { streamingUrl, ls_session, videoContentId: String(videoContentId) };
}

/**
 * STREAM per canale lineare:
 * prende la videoContentId corrente e poi chiama irdeto session-token
 */
export async function resolveLinearStream(session: ParamountSession, slug: string): Promise<{
    streamingUrl: string;
    ls_session: string;
    videoContentId: string;
} | null> {
    const api = new ParamountContentApi();
    const data = await api.liveChannelListings(session.cookies, slug);
    const listing = (data?.listing ?? data?.listings ?? [])[0] ?? null;
    if (!listing?.videoContentId) return null;

    const tokenResp = await api.irdetoSessionToken(session.cookies, String(listing.videoContentId));
    const streamingUrl = tokenResp?.streamingUrl;
    const ls_session = tokenResp?.ls_session;

    if (!streamingUrl || !ls_session) return null;

    return { streamingUrl, ls_session, videoContentId: String(listing.videoContentId) };
}
