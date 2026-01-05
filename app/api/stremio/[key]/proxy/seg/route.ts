import { NextRequest, NextResponse } from "next/server";
import { readSessionFromKey } from "@/lib/auth/session";
import { unseal } from "@/lib/auth/jwe";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function needsParamountAuth(hostname: string) {
    const h = hostname.toLowerCase();
    return h.endsWith("cbsi.live.ott.irdeto.com") || h.endsWith("paramountplus.com") || h.endsWith("cbsivideo.com");
}

function buildCookieHeader(cookies: string[] | undefined) {
    if (!cookies?.length) return "";
    return cookies
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

function forwardHeaders(req: NextRequest) {
    const h: Record<string, string> = {};

    const range = req.headers.get("range");
    if (range) h["range"] = range;

    const inm = req.headers.get("if-none-match");
    if (inm) h["if-none-match"] = inm;

    const ims = req.headers.get("if-modified-since");
    if (ims) h["if-modified-since"] = ims;

    const ua = req.headers.get("user-agent");
    if (ua) h["user-agent"] = ua;

    const accept = req.headers.get("accept");
    if (accept) h["accept"] = accept;

    return h;
}

function copyRespHeaders(res: Response) {
    const out = new Headers({
        "Access-Control-Allow-Origin": "*",
        // evitare cache strani durante transizioni DAI
        "Cache-Control": "no-store",
    });

    const pass = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
        "cache-control", // Importante per non ri-scaricare segmenti durante i glitch
        "content-encoding",
        "date" // Alcuni player usano la data per sincronizzare i buffer
    ];

    for (const k of pass) {
        const v = res.headers.get(k);
        if (v) out.set(k, v);
    }

    return out;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const session = await readSessionFromKey(decodeURIComponent(key));
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const u = req.nextUrl.searchParams.get("u");
    const t = req.nextUrl.searchParams.get("t");
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    const tok: any = await unseal(t);
    if (!tok || tok.kind !== "pplus_proxy" || !tok.ls_session) {
        return new NextResponse("Bad token", { status: 401 });
    }

    let upstreamUrl: URL;
    try {
        upstreamUrl = new URL(Buffer.from(u, 'base64url').toString('utf-8'));
    } catch {
        return new NextResponse("Bad upstream url", { status: 400 });
    }

    const headers: Record<string, string> = {
        ...forwardHeaders(req),
    };

    // Solo per host che lo richiedono davvero
    if (needsParamountAuth(upstreamUrl.hostname)) {
        headers["authorization"] = `Bearer ${tok.ls_session}`;

        const cookie = buildCookieHeader(session.cookies);
        if (cookie) headers["cookie"] = cookie;

        headers["origin"] = "https://www.paramountplus.com";
        headers["referer"] = "https://www.paramountplus.com/";
    }

    const method = req.method === "HEAD" ? "HEAD" : "GET";

    const res = await fetch(upstreamUrl.toString(), {
        method,
        headers,
        redirect: "follow",
        cache: "no-store",
    });

    // ✅ Status passthrough (200/206/304 ecc) + header passthrough
    const outHeaders = copyRespHeaders(res);
    if (upstreamUrl.pathname.endsWith(".ts")) {
        outHeaders.set("Content-Type", "video/mp2t");
    } else if (upstreamUrl.pathname.endsWith(".m4s")) {
        outHeaders.set("Content-Type", "video/iso.segment");
    }

    // HEAD senza body
    if (method === "HEAD") {
        return new NextResponse(null, { status: res.status, headers: outHeaders });
    }

    return new NextResponse(res.body, { status: res.status, headers: outHeaders });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}
