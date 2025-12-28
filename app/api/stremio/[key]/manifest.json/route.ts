import { NextResponse } from "next/server";
import { readSessionFromKey } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const session = await readSessionFromKey(decodeURIComponent(key));
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

    const manifest = {
        id: "org.paramountplus.us.sports",
        version: "1.0.0",
        name: "Paramount+ Sports (US)",
        description: "Unofficial Paramount+ US Sports Addon. Watch all live events from your account.",
        logo: "https://play-lh.googleusercontent.com/oi4GE8ulxHp4Y2xVzKu_WAMrgE4Jj4Kbdd7hAWLeoZTsMtC5bYTd2xcYhlvMk69pTFY",
        background: "https://static0.howtogeekimages.com/wordpress/wp-content/uploads/2023/08/paramount-1.jpg?w=1600&h=900&fit=crop",
        resources: ["catalog", "meta", "stream"],
        types: ["tv"],
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
