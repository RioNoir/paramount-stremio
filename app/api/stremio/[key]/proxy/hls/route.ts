import { NextRequest, NextResponse } from "next/server";
import {ParamountClient} from "@/lib/paramount/client";
import {needsParamountAuth, buildCookieHeader, guessBaseOrigin, PPLUS_BASE_URL, PPLUS_HEADER} from "@/lib/paramount/utils";
import {httpClient} from "@/lib/http/client";
import {rewriteM3U8, filterMasterByClosestBandwidth} from "@/lib/paramount/proxy/hls";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function handle(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const u = req.nextUrl.searchParams.get("u");
    const t = req.nextUrl.searchParams.get("t");
    const b = req.nextUrl.searchParams.get("b") ?? null;
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    let upstreamUrl: URL;
    let upstreamToken: string;
    try {
        upstreamUrl = new URL(Buffer.from(u, 'base64url').toString('utf-8'));
        upstreamToken = Buffer.from(t, 'base64url').toString('utf-8');
    } catch {
        return new NextResponse("Bad upstream url or token", { status: 400 });
    }

    const headers: Record<string, string> = {
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        "user-agent": await PPLUS_HEADER(),
        accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
    };

    if (needsParamountAuth(upstreamUrl.hostname)) {
        headers["authorization"] = `Bearer ${upstreamToken}`;

        const cookie = buildCookieHeader(session.cookies);
        if (cookie) headers["cookie"] = cookie;

        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const {status, data} = await httpClient.get(upstreamUrl.toString(), {
        headers: headers
    });

    if (req.method === "HEAD") {
        const h = new Headers({
            "Allow": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
            "Content-Type": "application/vnd.apple.mpegurl",
        });
        return new NextResponse(null, { status: status, headers: h });
    }

    const baseOrigin = guessBaseOrigin(req);

    const text = data.toString();
    let rewritten = rewriteM3U8({
        text,
        upstreamUrl,
        baseOrigin,
        key,
        token: t
    });

    if(b){
        rewritten = filterMasterByClosestBandwidth(rewritten, parseInt(b));
    }

    const outHeaders = new Headers({
        "Allow": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        "Content-Type": "application/vnd.apple.mpegurl",
        //"Content-Type": "text/plain",
    });

    return new NextResponse(rewritten, { status: status, headers: outHeaders });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}
