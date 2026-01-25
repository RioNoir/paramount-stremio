import { NextRequest, NextResponse } from "next/server";
import {ParamountClient} from "@/lib/paramount/client";
import {needsParamountAuth, buildCookieHeader, forwardHeaders, copyRespHeaders, checkMyIp, PPLUS_BASE_URL, PPLUS_HEADER} from "@/lib/paramount/utils";
import {httpClient} from "@/lib/http/client";

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
        ...forwardHeaders(req),
    };
    headers["user-agent"] = PPLUS_HEADER;

    if (needsParamountAuth(upstreamUrl.hostname)) {
        headers["authorization"] = `Bearer ${upstreamToken}`;

        const cookie = buildCookieHeader(session.cookies);
        if (cookie) headers["cookie"] = cookie;

        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const method = req.method === "HEAD" ? "HEAD" : "GET";

    const {status: status, data: data, headers: resHeaders} = await httpClient.get(upstreamUrl.toString(), {
        headers: headers,
        responseType: 'arraybuffer'
    });

    const outHeaders = copyRespHeaders(resHeaders);
    if (upstreamUrl.pathname.endsWith(".ts")) {
        outHeaders.set("Content-Type", "video/mp2t");
    } else if (upstreamUrl.pathname.endsWith(".m4s")) {
        outHeaders.set("Content-Type", "video/iso.segment");
    }
    outHeaders.set("Allow", "GET, HEAD, OPTIONS");
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    outHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    outHeaders.set("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate");

    if (method === "HEAD") {
        return new NextResponse(null, { status: status, headers: outHeaders });
    }

    return new NextResponse(data, { status: status, headers: outHeaders });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}
