import { z } from "zod";
import { ParamountClient } from "@/lib/paramount/client";
import { unseal, seal, type PendingPayload, type SessionPayload } from "@/lib/auth/jwe";
import { withCors, optionsCors } from "@/lib/stremio/cors";

export function OPTIONS() { return optionsCors(); }

const schema = z.object({
    pendingToken: z.string().min(20),
});

export async function POST(req: Request) {
    const url = new URL(req.url);
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return withCors(Response.json({ error: "Bad input" }, { status: 400 }));

    let pending: PendingPayload;
    try {
        const p = await unseal(parsed.data.pendingToken);
        if (p.kind !== "pending") throw new Error("Not pending token");
        pending = p;
    } catch {
        return withCors(Response.json({ ok: false, error: "Invalid pendingToken" }, { status: 400 }));
    }

    if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
        return withCors(Response.json({ ok: false, error: "pendingToken expired" }, { status: 400 }));
    }

    const client = new ParamountClient();
    const polled = await client.pollDeviceAuth({
        deviceIdRaw: pending.deviceIdRaw,
        deviceIdHashed: pending.deviceIdHashed,
        activationCode: pending.activationCode,
        deviceToken: pending.deviceToken,
    });

    if (!polled.ok || !polled.cookies) {
        return withCors(Response.json({ ok: false }));
    }

    const sessionPayload: SessionPayload = {
        kind: "session",
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 giorni
        cookies: polled.cookies,
    };

    try {
        const tmpSession = { cookies: polled.cookies, expiresAt: sessionPayload.expiresAt };
        sessionPayload.profileId = await client.pickProfileId(tmpSession as any);
    } catch {}

    // @ts-ignore
    const key = await seal(sessionPayload);

    const base = url.origin || process.env.APP_BASE_URL || "http://localhost:3000";
    // ✅ KEY nel PATH (non in query) + termina con /manifest.json
    const manifestUrl = `${base}/api/stremio/${encodeURIComponent(key)}/manifest.json`;

    return withCors(Response.json({ ok: true, manifestUrl }));
}
