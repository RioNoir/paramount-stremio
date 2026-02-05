import { NextRequest, NextResponse } from "next/server";
import { httpClient } from "@/lib/http/client";
import {ParamountClient} from "@/lib/paramount/client";
import {buildCookieHeader, needsParamountAuth, PPLUS_BASE_URL, PPLUS_HEADER} from "@/lib/paramount/utils";
import {extend} from "@/lib/http/sid";

export async function POST(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
    const { sid } = await ctx.params;

    const session = sid ? extend(sid) : null;
    const key = session?.key ?? null;
    const u = session?.u ?? null;
    const t = session?.t ?? null;
    const l = session?.l ?? null;
    if (!session || !key) {
        return new Response("Invalid Session", { status: 403 });
    }
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });
    if (!l) return new NextResponse("Missing License URL", { status: 400 });

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const pSession = client.getSession();
    if (!pSession) return new NextResponse("Unauthorized", { status: 401 });

    const challenge = await req.arrayBuffer();
    const challengeBuffer = Buffer.from(challenge);
    const url = new URL(l);
    const upstreamUrl = new URL(u);
    const upstreamToken = t.toString();

    const headers: Record<string, string> = {
        "cache-control": "no-cache",
        "user-agent": await PPLUS_HEADER(),
        "accept": "*/*",
        "content-type": "application/octet-stream",
        "content-length": challengeBuffer.length.toString(),
    };
    if (needsParamountAuth(upstreamUrl.hostname)) {
        headers["authorization"] = `Bearer ${upstreamToken}`;
        const cookie = buildCookieHeader(pSession.cookies);
        if (cookie) headers["cookie"] = cookie;
        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const {status: status, data: data} = await httpClient.post(url.toString(),
        challengeBuffer,
        {
            headers: headers,
            responseType: 'arraybuffer',
        });

    return new NextResponse(data, {
        status: status,
        headers: {
            'Content-Type': 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
        }
    });
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-dtp',
            'Access-Control-Max-Age': '86400',
        },
    });
}