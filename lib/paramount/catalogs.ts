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
    extra?: { search?: string; skip?: number };
}): Promise<StremioMeta[]> {
    let { type, id, session, extra } = args;

    id = stripJsonSuffix(id);

    const skip = extra?.skip ?? 0;
    const search = safeLower(extra?.search);
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
        const sportListings: any = await getSportListing(session, false);
        const sportMetas = sportListings.map(mapSportListingToMeta).filter(Boolean) as StremioMeta[];

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
