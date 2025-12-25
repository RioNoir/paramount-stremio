import { NextRequest, NextResponse } from "next/server";
import { readSessionFromKey } from "@/lib/auth/session";
import { parsePplusId } from "@/lib/paramount/mapping";
import { buildSportMeta, buildLinearMeta } from "@/lib/paramount/sports";

export const runtime = "nodejs";

function stripJsonSuffix(s: string) {
    return s.endsWith(".json") ? s.slice(0, -5) : s;
}

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ key: string; type: string; id?: string[] }> }
) {
    const { key, type, id } = await ctx.params;

    const session = await readSessionFromKey(decodeURIComponent(key));
    if (!session) return NextResponse.json({ meta: null }, { status: 200 });

    const cleaned = stripJsonSuffix(String(id));
    const decoded = decodeURIComponent(cleaned);

    if (type !== "tv") return NextResponse.json({ meta: null }, { status: 200 });

    const parsed = parsePplusId(decoded);

    if (parsed.kind === "sport") {
        const meta = await buildSportMeta(session, parsed.key);
        return NextResponse.json({ meta }, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (parsed.kind === "linear") {
        const meta = await buildLinearMeta(session, parsed.key);
        return NextResponse.json({ meta }, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    return NextResponse.json({ meta: null }, { status: 200 });
}