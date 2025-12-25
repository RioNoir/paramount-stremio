export type StremioMetaPreview = {
    id: string;
    type: "movie" | "series";
    name: string;
    poster?: string;
    background?: string;
    description?: string;
    genres?: string[];
};

function uniq<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
}
