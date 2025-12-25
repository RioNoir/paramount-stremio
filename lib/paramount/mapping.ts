const PPLUS_IMG_BASE = "https://wwwimage-us.pplusstatic.com/base/"; // si vede dai link “base/files/...” :contentReference[oaicite:5]{index=5}

export function normImg(urlOrPath?: string | null): string | undefined {
    if (!urlOrPath) return undefined;
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) return urlOrPath;
    return new URL(urlOrPath.replace(/^\//, ""), PPLUS_IMG_BASE).toString();
}

export function pplusMovieId(contentId: string) {
    return `pplus:movie:${contentId}`;
}

export function pplusSeriesId(showId: number | string) {
    return `pplus:series:${showId}`;
}

export function pplusSportId(listingId: string | number) {
    return `pplus:sport:${listingId}`;
}

export function pplusLinearId(slug: string) {
    return `pplus:linear:${slug}`;
}

export function parsePplusId(id: string):
    | { kind: "movie"; key: string }
    | { kind: "series"; key: string }
    | { kind: "sport"; key: string }
    | { kind: "linear"; key: string }
    | { kind: "unknown"; key: string } {
    const parts = id.split(":");
    if (parts.length >= 3 && parts[0] === "pplus") {
        const kind = parts[1];
        const key = parts.slice(2).join(":");
        if (kind === "movie") return { kind: "movie", key };
        if (kind === "series") return { kind: "series", key };
        if (kind === "sport") return { kind: "sport", key };
        if (kind === "linear") return { kind: "linear", key };
    }
    return { kind: "unknown", key: id };
}
