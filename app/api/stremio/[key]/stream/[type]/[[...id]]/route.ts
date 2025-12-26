import { NextRequest, NextResponse } from "next/server";
import { readSessionFromKey } from "@/lib/auth/session";
import { parsePplusId } from "@/lib/paramount/mapping";
import { resolveSportStream, resolveLinearStream } from "@/lib/paramount/sports";
import { seal } from "@/lib/auth/jwe";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

function stripJsonSuffix(s: string) {
    return s.endsWith(".json") ? s.slice(0, -5) : s;
}

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ key: string; type: string; id?: string[] }> }
) {
    const { key, type, id } = await ctx.params;

    const session = await readSessionFromKey(decodeURIComponent(key));
    if (!session) return NextResponse.json({ streams: [] }, { status: 200 });

    //const raw = (id?.join("/") ?? "");
    const cleaned = stripJsonSuffix(String(id));
    const decoded = decodeURIComponent(cleaned);

    if (type !== "tv") return NextResponse.json({ streams: [] }, { status: 200 });

    const parsed = parsePplusId(decoded);

    let streamData = null;

    if (parsed.kind === "sport") {
        streamData = await resolveSportStream(session, parsed.key);
    } else if (parsed.kind === "linear") {
        streamData = await resolveLinearStream(session, parsed.key);
    }

    if (!streamData) return NextResponse.json({ streams: [] }, { status: 200 });

    // Token per proxy: contiene ls_session + scadenza breve
    // @ts-ignore
    const proxyToken = await seal({
        kind: "pplus_proxy",
        ls_session: streamData.ls_session,
        exp: Date.now() + 120 * 60 * 1000, // 30 min
    });

    // Proxy playlist endpoint
    const base = new URL(req.url);
    const proxyUrl = new URL(`/api/stremio/${encodeURIComponent(key)}/proxy/hls.m3u8`, base.origin);
    proxyUrl.searchParams.set("u", streamData.streamingUrl);
    proxyUrl.searchParams.set("t", proxyToken);

    return NextResponse.json(
        {
            streams: [
                {
                    name: "Paramount+ Sports",
                    title: "HLS (proxied)",
                    url: proxyUrl.toString(),
                },
            ],
        },
        { status: 200, headers: { "Access-Control-Allow-Origin": "*" } }
    );
}
