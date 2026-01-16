// lib/mediaflow.ts
export type MediaFlowConfig = {
    url: string;
    password: string;
    expirationSeconds?: number;
};

function normalizeBaseUrl(raw: string) {
    return raw.replace(/\/+$/, "");
}

function buildCookieHeader(cookies: string[] | undefined): string | undefined {
    if (!cookies?.length) return undefined;
    return cookies
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

export function getMediaFlowConfig(): MediaFlowConfig | null {
    const url = process.env.MFP_URL;
    const password = process.env.MFP_PASS;
    if (!url || !password) return null;

    return {
        url: normalizeBaseUrl(url),
        password,
        expirationSeconds: Number(process.env.MFP_EXPIRATION ?? "3600"),
    };
}

export function wrapUrlWithMediaFlow(destinationUrl: URL, session: any, lsSession: string, mpegts: boolean): string | null {
    const cfg = getMediaFlowConfig();
    if (!cfg) return null;

    const headers: Record<string, string> = {
        //"user-agent": "AppleTV6,2/11.1",
        "user-agent": "Paramount+/15.5.0 (com.cbs.ott; androidphone) okhttp/5.1.0",
        "origin": "https://www.paramountplus.com",
        "referer": "https://www.paramountplus.com/",
    };

    headers["authorization"] = `Bearer ${lsSession}`;
    const cookie = buildCookieHeader(session.cookies);
    if (cookie) headers["set-cookie"] = cookie;

    const encodedUrl = Buffer.from(destinationUrl.toString()).toString('base64url');

    let url = `${cfg.url}/proxy/hls/manifest.m3u8`;
    if(mpegts){
        url = `${cfg.url}/proxy/stream`;
    }

    const finalUrl = new URL(url);
    finalUrl.searchParams.set("api_password", cfg.password);
    finalUrl.searchParams.set("d", encodedUrl);
    Object.entries(headers).forEach(([key, value]) => {
        finalUrl.searchParams.set(`h_${key}`, value);
    });

    return finalUrl.toString();
}
