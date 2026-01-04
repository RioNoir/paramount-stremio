// lib/mediaflow.ts
export type MediaFlowConfig = {
    url: string;
    password: string;
    expirationSeconds?: number;
};

function normalizeBaseUrl(raw: string) {
    return raw.replace(/\/+$/, "");
}

export function getProxyMode(): string {
    return (process.env.APP_PROXY_MODE || "internal").toLowerCase().toString();
}

function getMfpBase(): string | null {
    const u = process.env.MFP_URL;
    if (!u) return null;
    return normalizeBaseUrl(u);
}

function buildCookieHeader(cookies: string[] | undefined): string | undefined {
    if (!cookies?.length) return undefined;
    return cookies
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

function isParamountDomain(url: string) {
    try {
        const h = new URL(url).hostname.toLowerCase();
        return (
            h.endsWith("paramountplus.com") ||
            h.endsWith("pplusstatic.com") ||
            h.endsWith("cbsi.com") ||
            h.endsWith("cbsi.live.ott.irdeto.com")
        );
    } catch {
        return false;
    }
}

function isDAI(url: string) {
    try {
        return new URL(url).hostname.toLowerCase().includes("dai.google.com");
    } catch {
        return url.includes("dai.google.com");
    }
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

/**
 * Genera un URL MediaFlowProxy che proxy-a direttamente un master.m3u8 upstream.
 * Usa /generate_url così non esponi query lunghe e puoi “criptare” con api_password root-level. :contentReference[oaicite:3]{index=3}
 */
export async function buildMfpHlsUrl(params: {
    upstreamHlsUrl: string;        // es. master.m3u8 (Paramount o DAI)
    lsSession?: string;            // bearer per domini Paramount
    cookies?: string[];            // cookies Paramount
    filename?: string;             // opzionale
}): Promise<string | null> {
    const base = getMfpBase();
    const password = process.env.MFP_PASSWORD;
    if (!base || !password) return null;

    const expiration = Number(process.env.MFP_EXPIRATION ?? "3600");

    // MediaFlowProxy HLS endpoint: /proxy/hls/manifest.m3u8 con d=<dest> e h_* headers :contentReference[oaicite:4]{index=4}
    const endpoint = "/proxy/hls/manifest.m3u8";

    // Header da inviare upstream:
    // - su DAI (dai.google.com) NON mandare Authorization/Cookie
    // - su Paramount/Irdeto sì
    const query_params: Record<string, string> = {
        api_password: password,
        d: params.upstreamHlsUrl,
        // header generici utili
        "h_user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "h_accept": "*/*",
        "h_accept-language": "en-US,en;q=0.9",
    };

    if (!isDAI(params.upstreamHlsUrl) && isParamountDomain(params.upstreamHlsUrl)) {
        if (params.lsSession) query_params["h_authorization"] = `Bearer ${params.lsSession}`;

        const cookieHeader = buildCookieHeader(params.cookies);
        if (cookieHeader) query_params["h_cookie"] = cookieHeader;

        // spesso utili con piattaforme OTT
        query_params["h_origin"] = "https://www.paramountplus.com";
        query_params["h_referer"] = "https://www.paramountplus.com/";
    }

    const query = new URLSearchParams(query_params);
    const queryString = query.toString();
    return `${base}${endpoint}?${queryString}`;

    // const payload: any = {
    //     mediaflow_proxy_url: base,
    //     endpoint,
    //     query_params,
    //     expiration,
    //     api_password: password, // root-level -> encrypted :contentReference[oaicite:5]{index=5}
    // };
    //
    // // filename: docs dicono che è solo per /proxy/stream, quindi NON usarlo qui. :contentReference[oaicite:6]{index=6}
    //
    // try {
    //     const res = await fetch(`${base}/generate_url`, {
    //         method: "POST",
    //         headers: { "Content-Type": "application/json" },
    //         cache: "no-store",
    //         body: JSON.stringify(payload),
    //     });
    //
    //     if (!res.ok) return null;
    //
    //     const data = (await res.json()) as { url?: string };
    //     return data?.url ?? null;
    // } catch {
    //     return null;
    // }
}


export function wrapUrlWithMediaFlow(destinationUrl: URL, session: any, ls_session: string, mpegts: boolean): string | null {
    const cfg = getMediaFlowConfig();
    if (!cfg) return null;

    //return `${cfg.url}/proxy/stream?api_password=${cfg.password}&d=${encodeURIComponent(destinationUrl)}`;

    // 1. Costruiamo l'oggetto headers esattamente come nel tuo codice
    const headers: Record<string, string> = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "origin": "https://www.paramountplus.com",
        "referer": "https://www.paramountplus.com/",
        //"accept": "*/*"
    };

    // Aggiunta dinamica di Auth e Cookie
    headers["authorization"] = `Bearer ${ls_session}`;
    const cookie = buildCookieHeader(session.cookies);
    if (cookie) headers["set-cookie"] = cookie;

    // 2. Codifichiamo l'URL originale in Base64 (URL-Safe)
    const encodedUrl = Buffer.from(destinationUrl.toString()).toString('base64url');

    // 3. Codifichiamo gli HEADERS in Base64 (URL-Safe)
    //const encodedHeaders = Buffer.from(JSON.stringify(headers)).toString('base64url');

    // 4. Costruiamo l'URL finale per Mediaflow
    //const finalUrl = new URL(`${cfg.url}/proxy/hls/manifest.m3u8`);

    let url = `${cfg.url}/proxy/hls/manifest.m3u8`;
    if(mpegts){
        url = `${cfg.url}/proxy/stream`;
    }

    const finalUrl = new URL(url);
    finalUrl.searchParams.set("api_password", cfg.password);
    finalUrl.searchParams.set("d", encodedUrl);
    //finalUrl.searchParams.set("h", encodedHeaders); // Passiamo qui i tuoi headers!
    Object.entries(headers).forEach(([key, value]) => {
        //console.log(`Header: ${key}, Valore: ${value}`);
        // Qui puoi manipolarli, ad esempio per aggiungerli a un URLSearchParams
        finalUrl.searchParams.set(`h_${key}`, value); // Passiamo qui i tuoi headers!
    });

    return finalUrl.toString();
}
