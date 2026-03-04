import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { resolveSportStream } from "@/lib/paramount/types/sports";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ key: string; id: string }> }
) {
    const { key, id } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) {
        return new NextResponse("Invalid session", { status: 401 });
    }

    const streamData = await resolveSportStream(session, decodeURIComponent(id));
    if (!streamData?.streamingUrl || !streamData?.lsSession) {
        return new NextResponse("Stream not available", { status: 404 });
    }

    const base = new URL(process.env.BASE_URL || req.url || "http://localhost:3000");
    const target = new URL(`/api/stremio/${encodeURIComponent(key)}/proxy/hls`, base.origin);
    target.searchParams.set("u", Buffer.from(streamData.streamingUrl).toString("base64url"));
    target.searchParams.set("t", Buffer.from(streamData.lsSession).toString("base64url"));

    return NextResponse.redirect(target, { status: 302 });
}
