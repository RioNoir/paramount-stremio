// lib/mediaflow.ts
export type MediaFlowConfig = {
    url: string;
    password: string;
    expirationSeconds?: number;
};

function normalizeBaseUrl(raw: string) {
    // rimuove trailing slash
    return raw.replace(/\/+$/, "");
}

export function getMediaFlowConfig(): MediaFlowConfig | null {
    const url = process.env.MFP_URL;
    const password = process.env.MFP_PASSWORD;
    if (!url || !password) return null;

    return {
        url: normalizeBaseUrl(url),
        password,
        expirationSeconds: Number(process.env.MFP_EXPIRATION ?? "3600"),
    };
}

/**
 * Wrappa un URL (es. il tuo proxy HLS) dentro MediaFlow Proxy usando /generate_url. :contentReference[oaicite:3]{index=3}
 * Ritorna l'URL generato da MFP, oppure null se fallisce.
 */
export async function wrapUrlWithMediaFlow(destinationUrl: string): Promise<string | null> {
    const cfg = getMediaFlowConfig();
    if (!cfg) return null;

    return `${cfg.url}/proxy/stream?api_password=${cfg.password}&d=${encodeURIComponent(destinationUrl)}`;

    // try {
    //     const endpoint = "/proxy/stream"; // MFP proxy “generico” per URL HTTP(S)
    //     const res = await fetch(`${cfg.url}/generate_url`, {
    //         method: "POST",
    //         headers: { "Content-Type": "application/json" },
    //         cache: "no-store",
    //         body: JSON.stringify({
    //             mediaflow_proxy_url: cfg.url,
    //             endpoint,
    //             destination_url: destinationUrl,
    //             expiration: cfg.expirationSeconds ?? 3600,
    //             api_password: cfg.password, // root-level => encrypted :contentReference[oaicite:4]{index=4}
    //         }),
    //     });
    //
    //     if (!res.ok) {
    //         // Non throwo: fallback al proxy interno
    //         return null;
    //     }
    //
    //     const data = (await res.json()) as { url?: string };
    //     if (!data?.url) return null;
    //
    //     return data.url;
    // } catch {
    //     return null;
    // }
}
