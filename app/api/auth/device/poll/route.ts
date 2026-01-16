import {ParamountAuthStart, ParamountClient, ParamountSession} from "@/lib/paramount/client";
import { withCors, optionsCors } from "@/lib/stremio/cors";

export function OPTIONS() { return optionsCors(); }

export async function POST(req: Request) {
    const url = new URL(req.url);
    const auth: ParamountAuthStart = await req.json().catch(() => null);

    if (Date.now() - Date.parse(auth.createdAt) > 10 * 60 * 1000) {
        return withCors(Response.json({ ok: false, error: "Auth expired" }, { status: 400 }));
    }

    const client = new ParamountClient();
    const polled = await client.pollDeviceAuth(auth);

    if (!polled.ok || !polled.cookies) {
        return withCors(Response.json({ ok: false }));
    }

    const session : ParamountSession = {
        cookies: polled.cookies,
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365
    };
    await client.setSession(session);
    const key = await client.getSessionKey();

    const base = process.env.BASE_URL || url.origin || "http://localhost:3000";
    const manifestUrl = `${base}/api/stremio/${encodeURIComponent(key)}/manifest.json`;

    return withCors(Response.json({ ok: true, manifestUrl }));
}
