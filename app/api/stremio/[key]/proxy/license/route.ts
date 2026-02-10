import { NextRequest, NextResponse } from "next/server";
import { httpClient } from "@/lib/http/client";
import {ParamountClient} from "@/lib/paramount/client";
import {PPLUS_HEADER} from "@/lib/paramount/utils";

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const licenseUrl = req.nextUrl.searchParams.get("u");
    if (!licenseUrl) return new NextResponse("Missing License URL", { status: 400 });
    const decodedUrl = Buffer.from(licenseUrl, 'base64url').toString('utf-8');

    const challenge = await req.arrayBuffer();
    const challengeBuffer = Buffer.from(challenge);
    const url = new URL(decodedUrl);

    const userAgent = await PPLUS_HEADER();
    const {status: status, data: data} = await httpClient.post(url.toString(),
        challengeBuffer,
        {
            responseType: 'arraybuffer',
            headers: {
                "Content-Type": "application/octet-stream",
                "Accept": "*/*",
                "Content-Length": challengeBuffer.length.toString(),
                "User-Agent": userAgent,
                ...(session?.cookies?.length ? { Cookie: session.cookies.map((c) => c.split(";")[0]).join("; ") } : {}),
            },
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