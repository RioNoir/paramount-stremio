import { normImg, pickLeagueLabel, pickPoster } from "@/lib/paramount/utils";

type LiveProgram = {
    title?: string;
    description?: string;
    startTimestamp?: number;
    endTimestamp?: number;
    filePathThumb?: string;
    filepathThumb?: string;
    filePathWideThumb?: string;
    [key: string]: unknown;
};

export type IptvChannel = {
    slug: string;
    name: string;
    logo?: string;
    group?: string;
    source: "live" | "sport";
    programs: LiveProgram[];
};

function firstNumber(values: unknown[]): number | undefined {
    for (const v of values) {
        if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return undefined;
}

export function xmlEscape(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

export function xmlTvDate(ms?: number): string | null {
    if (!ms || !Number.isFinite(ms)) return null;
    const date = new Date(ms);
    const y = String(date.getUTCFullYear());
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${y}${m}${d}${hh}${mm}${ss} +0000`;
}

function pickProgramPoster(program: LiveProgram): string | undefined {
    return (
        normImg(program.filePathThumb) ??
        normImg(program.filepathThumb) ??
        normImg(program.filePathWideThumb)
    );
}

export function tvgId(slug: string): string {
    return `pplus.live.${slug}`;
}

export function tvgSportId(listingId: string): string {
    return `pplus.sport.${listingId}`;
}

export function m3uAttrEscape(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll(/\r?\n/g, " ").trim();
}

export function extractChannelPrograms(channel: any): LiveProgram[] {
    const fromLive = [
        ...(Array.isArray(channel?.currentListing) ? channel.currentListing : []),
        ...(Array.isArray(channel?.upcomingListing) ? channel.upcomingListing : []),
    ];

    const fromListings = Array.isArray(channel?.listings)
        ? channel.listings
        : Array.isArray(channel?.data?.listings)
            ? channel.data.listings
            : [];

    const merged = [...fromLive, ...fromListings];
    const normalized = merged
        .map((p) => {
            const startTimestamp = firstNumber([
                p?.startTimestamp,
                p?.streamStartTimestamp,
                p?.airDate,
            ]);
            const endTimestamp = firstNumber([
                p?.endTimestamp,
                p?.streamEndTimestamp,
                p?.expirationTimestamp,
            ]);
            return {
                ...p,
                startTimestamp,
                endTimestamp,
            } as LiveProgram;
        })
        .filter((p) => p.startTimestamp && p.endTimestamp && p.endTimestamp > p.startTimestamp)
        .sort((a, b) => Number(a.startTimestamp) - Number(b.startTimestamp));

    const unique = new Map<string, LiveProgram>();
    for (const p of normalized) {
        const key = `${p.title ?? ""}|${p.startTimestamp}|${p.endTimestamp}`;
        if (!unique.has(key)) unique.set(key, p);
    }
    return Array.from(unique.values());
}

export function mapLiveChannel(rawChannel: any): IptvChannel | null {
    const slug = String(rawChannel?.slug ?? "").trim();
    const name = String(rawChannel?.channelName ?? rawChannel?.name ?? slug).trim();
    if (!slug || !name) return null;

    return {
        slug,
        name,
        logo: normImg(rawChannel?.filePathLogo ?? rawChannel?.brand?.filePathLogo),
        group: "Paramount+ Live",
        source: "live",
        programs: extractChannelPrograms(rawChannel).map((program) => ({
            ...program,
            filePathThumb: pickProgramPoster(program),
        })),
    };
}

export function mapSportChannel(rawSport: any): IptvChannel | null {
    const listingId = String(rawSport?.id ?? "").trim();
    const title = String(rawSport?.title ?? "").trim();
    if (!listingId || !title) return null;

    const startTimestamp = firstNumber([
        rawSport?.streamStartTimestamp,
        rawSport?.startTimestamp,
    ]);
    const endTimestamp = firstNumber([
        rawSport?.streamEndTimestamp,
        rawSport?.endTimestamp,
    ]);
    const league = pickLeagueLabel(rawSport);
    const channel = String(rawSport?.channelName ?? rawSport?.channelSlug ?? "").trim();
    const description = [
        league,
        channel && channel !== league ? channel : null,
        rawSport?.description ? String(rawSport.description) : null,
    ]
        .filter(Boolean)
        .join(" • ");

    return {
        slug: listingId,
        name: title,
        logo: normImg(rawSport?.filePathLogo) ?? pickPoster(rawSport),
        group: "Paramount+ Sports",
        source: "sport",
        programs: [{
            title,
            description: description || undefined,
            startTimestamp,
            endTimestamp,
            filePathThumb: pickPoster(rawSport),
        }],
    };
}
