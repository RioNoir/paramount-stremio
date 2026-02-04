export function pplusMovieId(contentId: string) {
    return `pplus:movie:${contentId}`;
}

export function pplusSeriesId(showId: number | string) {
    return `pplus:series:${showId}`;
}

export function pplusSportId(listingId: string | number) {
    return `pplus:sport:${listingId}`;
}

export function pplusLiveId(slug: string) {
    return `pplus:live:${slug}`;
}

export function parsePplusId(id: string):
    | { kind: "movie"; key: string }
    | { kind: "series"; key: string }
    | { kind: "sport"; key: string }
    | { kind: "live"; key: string }
    | { kind: "unknown"; key: string } {
    const parts = id.split(":");
    if (parts.length >= 3 && parts[0] === "pplus") {
        const kind = parts[1];
        const key = parts.slice(2).join(":");
        if (kind === "movie") return { kind: "movie", key };
        if (kind === "series") return { kind: "series", key };
        if (kind === "sport") return { kind: "sport", key };
        if (kind === "live") return { kind: "live", key };
    }
    return { kind: "unknown", key: id };
}