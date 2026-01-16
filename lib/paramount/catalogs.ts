import { ParamountClient, ParamountSession } from "@/lib/paramount/client";
import { StremioMeta } from "@/lib/stremio/types";
import {buildLinearMeta, getSportListing, mapSportListingToMeta} from "@/lib/paramount/types/sports";
import {list} from "postcss";

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

    //Sports
    if (type === "tv" && (id === "pplus_sports_live" || id === "pplus_sports_upcoming")) {
        const listings: any = await getSportListing(session, id);
        console.log(listings);
        let channelMetas: StremioMeta[] = [];

        const metasAll = listings
            .map(mapSportListingToMeta)
            .filter(Boolean) as StremioMeta[];
        metasAll.sort((a, b) => {
            return (a.releaseInfo ?? "").localeCompare(b.releaseInfo ?? "");
        });

        //Harcoded live channels
        if (id === "pplus_sports_live") {
            const alwaysLiveChannels = [
                {slug: "cbssportshq", fallbackName: "CBS Sports HQ"},
                {slug: "golazo", fallbackName: "GOLAZO Network"},
            ];
            channelMetas = await Promise.all(
                alwaysLiveChannels.map(async (c): Promise<StremioMeta> => {
                    const full = await buildLinearMeta(session, c.slug);
                    return {
                        id: `pplus:linear:${c.slug}`,
                        type: "tv",
                        name: full?.name || c.fallbackName,
                        logo: full?.logo || "",
                        poster: full?.poster || "",
                        posterShape: "landscape",
                        description: full?.description || "LIVE • Linear channel",
                        releaseInfo: String(full?.releaseInfo || "LIVE"),
                        background: full?.poster || ""
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
