import {ParamountSession} from "@/lib/paramount/client";
import {StremioMeta} from "@/lib/stremio/types";
import {getSportListing, mapSportListingToMeta} from "@/lib/paramount/types/sports";
import {getLiveListing, mapLiveListingToMeta} from "@/lib/paramount/types/live";

function stripJsonSuffix(s: string) {
    return s.endsWith(".json") ? s.slice(0, -5) : s;
}

function safeLower(s?: string) {
    return (s ?? "").toLowerCase();
}

export async function getCatalogMetas(args: {
    type: string;
    id: string;
    session: ParamountSession;
    extra?: { search?: string; skip?: number; genre?: "Live" | "Upcoming" };
}): Promise<StremioMeta[]> {
    let { type, id, session, extra } = args;

    id = stripJsonSuffix(id);

    const skip = extra?.skip ?? 0;
    const search = safeLower(extra?.search);
    const genre = extra?.genre;
    const pageSize = 100;

    //TODO: movies and shows

    //Live
    if (type === "tv" && id === "pplus_live") {
        const liveListings = await getLiveListing(session);
        const liveMetas = liveListings.map(mapLiveListingToMeta) as StremioMeta[];

        const filteredBySearch = search
            ? liveMetas.filter((m) => safeLower(m.name).includes(search))
            : liveMetas;

        return filteredBySearch.slice(skip, skip + pageSize);
    }

    //Sport
    if (type === "tv" && id === "pplus_sports") {
        const sportListings: any[] = await getSportListing(session, false);

        const now = Date.now();
        const filteredByGenre = genre === "Live"
            ? sportListings.filter((e) => {
                const startMs = typeof e.startTimestamp === "number" ? e.startTimestamp
                    : typeof e.streamStartTimestamp === "number" ? e.streamStartTimestamp : undefined;
                const endMs = typeof e.endTimestamp === "number" ? e.endTimestamp
                    : typeof e.streamEndTimestamp === "number" ? e.streamEndTimestamp : undefined;
                if (e?.isListingLive === true) return true;
                if (startMs && endMs && startMs <= now && now < endMs) return true;
                return false;
            })
            : genre === "Upcoming"
            ? sportListings.filter((e) => {
                if (e?.isListingLive === true) return false;
                const startMs = typeof e.startTimestamp === "number" ? e.startTimestamp
                    : typeof e.streamStartTimestamp === "number" ? e.streamStartTimestamp : undefined;
                return startMs !== undefined && startMs > now;
            })
            : sportListings;

        const sportMetas = filteredByGenre.map(mapSportListingToMeta).filter(Boolean) as StremioMeta[];

        sportMetas.sort((a, b) => {
            return (a.releaseInfo ?? "").localeCompare(b.releaseInfo ?? "");
        });

        const filteredBySearch = search
            ? sportMetas.filter((m) => safeLower(m.name).includes(search))
            : sportMetas;

        return filteredBySearch.slice(skip, skip + pageSize);
    }

    return [];
}
