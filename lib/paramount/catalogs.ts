// lib/paramount/catalogs.ts

import type { ParamountSession } from "@/lib/auth/session";
import { ParamountContentApi } from "@/lib/paramount/content";
import { normImg, pplusMovieId, pplusSeriesId, parsePplusId } from "@/lib/paramount/mapping";
import {buildLinearMeta} from "@/lib/paramount/sports";

export type StremioMetaPreview = {
    id: string;
    type: "movie" | "series" | "tv";
    name: string;
    logo?: string;
    poster?: string;
    posterShape?: "poster";
    description?: string;
    releaseInfo?: string;
};

export type StremioMeta = StremioMetaPreview & {
    background?: string;
    genres?: string[];
};

function stripJsonSuffix(s: string) {
    return s.endsWith(".json") ? s.slice(0, -5) : s;
}

function safeLower(s?: string) {
    return (s ?? "").toLowerCase();
}

function yearFromEpochMs(ms?: number): string | undefined {
    if (!ms || !Number.isFinite(ms)) return undefined;
    try {
        return new Date(ms).getUTCFullYear().toString();
    } catch {
        return undefined;
    }
}

function fmtUtc(ms?: number): string | undefined {
    if (!ms || !Number.isFinite(ms)) return undefined;

    const timezone = process.env.TIMEZONE || 'UTC'; // Fallback su UTC se non specificato
    const d = new Date(ms);

    return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(d);
}

function pickSportsPoster(e: any): string | undefined {
    return (
        normImg(e?.filePathThumb) ??
        normImg(e?.filePathWideThumb) ??
        normImg(e?.channelLogo) ??
        normImg(e?.channelLogoDark)
    );
}

function leagueLabel(e: any): string | undefined {
    // gameData spesso contiene info “competition / league / sport”
    const gd = e?.gameData;
    const parts: string[] = [];
    const a = gd?.competition ?? gd?.league ?? gd?.sport ?? gd?.sportName ?? gd?.leagueName;
    if (a) parts.push(String(a));
    const b = gd?.tournament ?? gd?.competitionName;
    if (b && b !== a) parts.push(String(b));
    const out = parts.filter(Boolean).join(" • ");
    return out || undefined;
}

function mapSportListingToMeta(e: any) {
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
    const league = leagueLabel(e);
    const logo = normImg(e?.filePathLogo);

    const descParts: string[] = [];
    if (league) descParts.push(league);
    if (channel) descParts.push(`${channel}`);
    if (e?.isListingLive === true) descParts.push("LIVE");
    if (e?.description) descParts.push(String(e.description));

    return {
        id: `pplus:sport:${String(eventId)}`,
        type: "tv" as const,
        name: String(title),
        poster: pickSportsPoster(e),
        logo: logo,
        posterShape: "landscape" as const,
        description: descParts.join(" • "),
        releaseInfo: fmtUtc(startMs),
    };
}

/**
 * CATALOGS
 * - movies: trending
 * - series: group_<id>
 */
export async function getCatalogMetas(args: {
    type: string;
    id: string;
    session: ParamountSession;
    extra?: { search?: string; skip?: number };
}): Promise<StremioMetaPreview[]> {
    let { type, id, session, extra } = args;

    // ✅ Stremio può passare "pplus_trending_movies.json"
    id = stripJsonSuffix(id);

    const skip = extra?.skip ?? 0;
    const search = safeLower(extra?.search);
    const pageSize = 100;

    const api = new ParamountContentApi();

    // ---------------- MOVIES: trending ----------------
    if (type === "movie" && id === "pplus_trending_movies") {
        // Struttura reale (dal tuo file): { ok: true, data: { trending: [...] } }
        const data: any = await api.trendingMovies(session.cookies);
        const items: any[] = data?.trending ?? [];

        const mapped = items
            .filter((x) => x?.content_type === "movie" && x?.content)
            .map((x) => {
                const c = x.content;
                const mc = c.movieContent ?? {};

                console.log(c);

                // nel tuo output l’id stream è content.content_id (string)
                const contentId = c.content_id ?? c.contentId ?? null;
                if (!contentId) return null;

                const name = (c.title ?? mc.title ?? "").toString().trim();
                if (!name) return null;

                const description =
                    mc.shortDescription ?? mc.description ?? c.description ?? "";

                // nel tuo output: c.thumbnail spesso è path relativo
                const poster = normImg(c.movieAssets?.filepath_movie_poster);
                const logo = normImg(c.movieAssets?.filepath_title_logo_regular);

                const releaseInfo = yearFromEpochMs(
                    mc.airDate ?? mc.pubDate ?? c.firstAvailableDate
                );

                return {
                    id: pplusMovieId(String(contentId)),
                    type: "movie" as const,
                    name,
                    description,
                    logo,
                    poster,
                    posterShape: "poster" as const,
                    releaseInfo,
                };
            })
            .filter(Boolean) as StremioMetaPreview[];

        const filtered = search
            ? mapped.filter((m) => safeLower(m.name).includes(search))
            : mapped;

        return filtered.slice(skip, skip + pageSize);
    }

    // ---------------- SERIES: group_<id> ----------------
    if (type === "series" && id.startsWith("pplus_group_")) {
        const groupId = Number(id.replace("pplus_group_", ""));
        if (!Number.isFinite(groupId)) return [];

        // Struttura reale (dal tuo file group_610): data.showGroups[0].showGroupItems[]
        const data: any = await api.group(session.cookies, String(groupId));
        const group = data?.group ?? [];
        const items: any[] = group?.showGroupItems ?? [];

        const mapped = items
            .filter((it) => it?.showId)
            .map((it) => {
                const showId = it.showId;

                console.log(it);

                const name = (it.title ?? it.label ?? it.showTitle ?? `Show ${showId}`)
                    .toString()
                    .trim();
                if (!name) return null;

                const poster =
                    normImg(it?.showAssets?.filepath_show_poster) ??
                    normImg(it?.showAssets?.filepath_show_browse_poster) ??
                    normImg(it?.filepathShowLogo);

                const logo = normImg(it?.showAssets?.filepath_title_logo_center);

                return {
                    id: pplusSeriesId(showId),
                    type: "series" as const,
                    name,
                    logo,
                    poster,
                    posterShape: "poster" as const,
                };
            })
            .filter(Boolean) as StremioMetaPreview[];

        const filtered = search
            ? mapped.filter((m) => safeLower(m.name).includes(search))
            : mapped;

        return filtered.slice(skip, skip + pageSize);
    }

    // ✅ Sports Live & Upcoming (type=tv)
    if (type === "tv" && (id === "pplus_sports_live" || id === "pplus_sports_upcoming")) {
        const data: any = await api.sportsLiveUpcoming(session.cookies);

        // Struttura dal tuo JSON: data.data.listings[] :contentReference[oaicite:1]{index=1}
        const listings: any[] = data?.listings ?? [];

        const now = Date.now();

        const filteredByMode = listings.filter((e) => {
            const isLive = e?.isListingLive === true;

            const startMs =
                typeof e.startTimestamp === "number" ? e.startTimestamp :
                    typeof e.streamStartTimestamp === "number" ? e.streamStartTimestamp :
                        undefined;

            // fallback: se manca start, non sappiamo dove metterlo
            if (!startMs) return false;

            if (id === "pplus_sports_live") {
                // LIVE: o flag isListingLive, oppure start<=now<end
                const endMs =
                    typeof e.endTimestamp === "number" ? e.endTimestamp :
                        typeof e.streamEndTimestamp === "number" ? e.streamEndTimestamp :
                            undefined;

                if (isLive) return true;
                if (endMs && startMs <= now && now < endMs) return true;
                return false;
            } else {
                // UPCOMING: non live e start nel futuro
                //return !isLive && startMs > now;
                return true;
            }
        });

        const metasAll = filteredByMode
            .map(mapSportListingToMeta)
            .filter(Boolean) as any[];

        // ordinamento
        metasAll.sort((a, b) => {
            // releaseInfo è testo, quindi ordiniamo sui timestamp originali:
            // per non complicare, ricreiamo start dal releaseInfo quando possibile.
            // (Se vuoi, possiamo invece restituire startMs dentro meta come campo custom nel description)
            return (a.releaseInfo ?? "").localeCompare(b.releaseInfo ?? "");
        });

        let channelMetas: Awaited<{
            releaseInfo: string | undefined;
            name: string;
            posterShape: string;
            description: string;
            id: string;
            type: string;
            poster: string | undefined
        }>[] = [];
        if (id === "pplus_sports_live") {
            const alwaysLiveChannels = [
                {slug: "cbssportshq", fallbackName: "CBS Sports HQ"},
                {slug: "golazo", fallbackName: "GOLAZO Network"},
            ];

            channelMetas = await Promise.all(
                alwaysLiveChannels.map(async (c) => {
                    const full = await buildLinearMeta(session, c.slug); // ✅ await
                    // buildLinearMeta ritorna { id, type:"tv", name, poster, background, description, releaseInfo... }

                    // Converti a MetaPreview (quello che Stremio usa in catalog)
                    return {
                        id: `pplus:linear:${c.slug}`,
                        type: "tv" as const,
                        name: full?.name || c.fallbackName,
                        poster: full?.poster,
                        posterShape: "landscape" as const,
                        description: full?.description || "LIVE • Linear channel",
                        releaseInfo: full?.releaseInfo,
                    };
                })
            );
        }

        const combined = [...channelMetas, ...metasAll];

        const filteredBySearch = search
            ? combined.filter((m) => safeLower(m.name).includes(search))
            : combined;

        return filteredBySearch.slice(skip, skip + pageSize);
    }

    return [];
}

/**
 * META
 * - series: /v2.0/androidphone/shows/{id}.json (dal tuo show_detail_106)
 * - movie: per ora minimo (se hai movie detail endpoint lo aggiungiamo)
 */
export async function getMeta(args: {
    type: string;
    id: string;
    session: ParamountSession;
}): Promise<StremioMeta> {
    let { type, id, session } = args;

    // ✅ Stremio chiama .../<id>.json
    id = stripJsonSuffix(id);

    // ✅ Stremio url-encoda l'id (pplus%3Aseries%3A106)
    const decodedId = decodeURIComponent(id);
    const parsed = parsePplusId(decodedId);

    const api = new ParamountContentApi();

    // ---------------- SERIES META ----------------
    if (type === "series" && parsed.kind === "series") {
        const showId = parsed.key;

        // Struttura reale: data.show.results[0]
        const data: any = await api.show(session.cookies, String(showId));
        console.log(data?.show?.results);
        const show = data?.show?.results?.[0];
        const assets = data?.showAssets ?? [];

        if (!show) {
            throw new Error(`Show detail vuoto per showId=${showId}`);
        }

        const poster =
            normImg(assets?.filepath_show_poster) ??
            normImg(show?.filepath_show_thumbnail) ??
            normImg(show?.filepath_show_browse_poster);

        const logo = normImg(assets?.filepath_title_logo_left);

        const background =
            normImg(assets?.filepath_show_page_header) ??
            normImg(assets?.filepath_show_hero_regular);

        const releaseInfo = show?.showPremiereDateStr
            ? new Date(show.showPremiereDateStr).getUTCFullYear().toString()
            : undefined;

        return {
            id: decodedId,
            type: "series",
            name: show.title ?? `Show ${showId}`,
            description: show.about ?? "",
            logo,
            poster,
            posterShape: "poster",
            background,
            releaseInfo,
        };
    }

    // ---------------- MOVIE META (minimo) ----------------
    if (type === "movie" && parsed.kind === "movie") {
        const movieId = parsed.key;
        const data: any = await api.movie(session.cookies, String(movieId));
        const movie = data?.movie;
        const assets = data?.movie?.movieAssets ?? [];

        if (!movie) {
            throw new Error(`Movie detail vuoto per movieId=${movie}`);
        }

        const poster =
            normImg(assets?.filepath_movie_poster) ??
            normImg(movie?.filepath_movie_thumbnail) ??
            normImg(movie?.filepath_movie_browse_poster);

        const logo = normImg(assets?.filepath_title_logo_left);

        const background =
            normImg(assets?.filepath_movie_page_header) ??
            normImg(assets?.filepath_movie_hero_regular);

        const releaseInfo = movie?.firstAvailableDate
            ? new Date(movie.firstAvailableDate).getUTCFullYear().toString()
            : undefined;

        return {
            id: decodedId,
            type: "movie",
            name: movie.title ?? `Movie ${movieId}`,
            description: movie.about ?? "",
            logo,
            poster,
            posterShape: "poster",
            background,
            releaseInfo,
        };
    }

    // mismatch/fallback
    return {
        id: decodedId,
        type: type === "series" ? "series" : "movie",
        name: decodedId,
        posterShape: "poster",
        description: "",
    };
}
