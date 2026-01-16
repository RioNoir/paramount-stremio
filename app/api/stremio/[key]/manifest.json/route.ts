import { NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) {
        return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const catalogs: any[] = [
        {
            type: "tv",
            id: "pplus_sports_live",
            name: "Paramount+ Sports (Live)",
            extra: [{ name: "search" }, { name: "skip" }],
        },
        {
            type: "tv",
            id: "pplus_sports_upcoming",
            name: "Paramount+ Sports",
            extra: [{ name: "search" }, { name: "skip" }],
        }
    ];

    const url = process.env.BASE_URL || _req.url || "http://localhost:3000";
    const base = new URL(url);
    const logo = new URL(`/icon.png`, base.origin);
    const background = new URL(`/fanart.png`, base.origin);

    const manifest = {
        id: "org.pplus.stremio",
        version: "1.0.0",
        name: "Paramount+ (US)",
        description: `Unofficial Paramount+ US Addon for Stremio. (Profile ID: ${session.profileId})`,
        logo: logo,
        background: background,
        resources: ["catalog", "meta", "stream"],
        types: ["tv"], //TODO: movie, series
        idPrefixes: ["pplus:"],
        catalogs,
    };

    return NextResponse.json(manifest, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
        },
    });
}
