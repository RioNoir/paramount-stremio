export function proxyImgUrl(baseOrigin: string, key: string, upstreamUrl?: string) {
    if (!upstreamUrl) return undefined;

    // se è già proxata, lascia stare
    if (upstreamUrl.includes(`/api/stremio/`) && upstreamUrl.includes(`/proxy/img`)) {
        return upstreamUrl;
    }

    const u = new URL(`/api/stremio/${encodeURIComponent(key)}/proxy/img`, baseOrigin);
    u.searchParams.set("u", upstreamUrl);
    return u.toString();
}
