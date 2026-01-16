import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { getCatalogMetas } from "@/lib/paramount/catalogs";

export const runtime = "nodejs";

function parseExtras(extra?: string[]) {
    const out: Record<string, string> = {};
    for (const seg of extra ?? []) {
        const i = seg.indexOf("=");
        if (i === -1) continue;
        out[decodeURIComponent(seg.slice(0, i))] = decodeURIComponent(seg.slice(i + 1));
    }
    return {
        search: out.search,
        skip: out.skip ? Number(out.skip) : 0,
    };
}

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ key: string; type: string; id: string; extra?: string[] }> }
) {
    const { key, type, id, extra } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return NextResponse.json({ metas: [] });

    const metas = await getCatalogMetas({
        type,
        id,
        session,
        extra: parseExtras(extra),
    });

    return NextResponse.json({ metas }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
