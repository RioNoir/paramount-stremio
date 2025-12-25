// lib/stremio/ids.ts

export type PplusKind = "movie" | "series" | "episode";

export function mkId(kind: PplusKind, nativeId: string | number) {
    return `pplus:${kind}:${nativeId}`;
}

export function mkMovieId(contentId: string | number) {
    return mkId("movie", contentId);
}

export function mkSeriesId(showId: string | number) {
    return mkId("series", showId);
}

export function mkEpisodeId(contentId: string | number) {
    return mkId("episode", contentId);
}

export function parseId(id: string): { kind: PplusKind; nativeId: string } | null {
    const m = /^pplus:(movie|series|episode):(.+)$/.exec(id);
    if (!m) return null;
    return { kind: m[1] as PplusKind, nativeId: m[2] };
}
