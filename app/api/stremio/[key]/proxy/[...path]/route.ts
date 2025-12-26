import { NextRequest, NextResponse } from "next/server";
import { unseal } from "@/lib/auth/jwe";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

function isExpired(payload: any) {
    return !payload?.exp || Date.now() > payload.exp;
}

function rewriteM3U8(body: string, req: NextRequest, key: string, token: string, upstreamBase: string) {
    const origin = new URL(req.url).origin;

    return body
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return line;

            // assoluto o relativo
            const abs = new URL(trimmed, upstreamBase).toString();

            const prox = new URL(`/api/stremio/${encodeURIComponent(key)}/proxy/seg`, origin);
            prox.searchParams.set("u", abs);
            prox.searchParams.set("t", token);
            return prox.toString();
        })
        .join("\n");
}

async function fetchWithAuth(url: string, bearer: string) {
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${bearer}` },
        cache: "no-store",
    });
    return res;
}

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ key: string; path: string[] }> }
) {
    const { key, path } = await ctx.params;
    const p = path?.[0] ?? "";

    const u = req.nextUrl.searchParams.get("u");
    const t = req.nextUrl.searchParams.get("t");

    if (!u || !t) {
        return new NextResponse("Missing u/t", { status: 400 });
    }

    let payload: any;
    try {
        payload = await unseal(t);
    } catch {
        return new NextResponse("Invalid token", { status: 403 });
    }

    if (payload?.kind !== "pplus_proxy" || isExpired(payload)) {
        return new NextResponse("Token expired", { status: 403 });
    }

    const bearer = payload.ls_session as string;
    if (!bearer) return new NextResponse("Missing bearer", { status: 403 });

    // playlist
    if (p === "hls.m3u8") {
        const res = await fetchWithAuth(u, bearer);
        if (!res.ok) return new NextResponse(`Upstream ${res.status}`, { status: 502 });

        const text = await res.text();

        // base per risoluzione relative URL
        const upstreamBase = new URL(u).toString();

        const rewritten = rewriteM3U8(text, req, key, t, upstreamBase);

        return new NextResponse(rewritten, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
            },
        });
    }

    // segment / child playlist (pass-through)
    if (p === "seg") {
        const res = await fetchWithAuth(u, bearer);
        if (!res.ok) return new NextResponse(`Upstream ${res.status}`, { status: 502 });

        const buf = await res.arrayBuffer();
        const ct = res.headers.get("content-type") || "application/octet-stream";

        return new NextResponse(buf, {
            status: 200,
            headers: {
                "Content-Type": ct,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
            },
        });
    }

    return new NextResponse("Not found", { status: 404 });
}
