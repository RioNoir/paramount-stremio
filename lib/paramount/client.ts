// lib/paramount/client.ts

import crypto from "crypto";
import type { ParamountSession } from "@/lib/auth/session";

const BASE_URL = "https://www.paramountplus.com";

// US token/locale (come già usato prima)
const AT_TOKEN_US = "ABB+XYTJa4Y14QBS5+7jCYvFe04w88I5dxzStu4zlQ4rqTTW/iMZ33tuiqPzzdgMJjQ=";
const LOCALE_US = "en-us";

function cookieHeader(cookies: string[]) {
    // i cookie salvati sono stringhe "name=value; Path=...; ..."
    // per Cookie header servono solo "name=value"
    return cookies.map((c) => c.split(";")[0]).join("; ");
}

function pickSetCookie(headers: Headers): string[] {
    // In Node/undici: headers.getSetCookie() spesso esiste.
    // In fallback, proviamo a leggere "set-cookie" singolo.
    // Nota: alcune piattaforme aggregano male; ma su Node 20 di solito è ok.
    const sc = typeof (headers as any).getSetCookie === "function" ? (headers as any).getSetCookie() : null;
    if (Array.isArray(sc) && sc.length) return sc;

    const single = headers.get("set-cookie");
    if (!single) return [];
    // Se arrivasse concatenato, lo lasciamo comunque come stringa singola.
    return [single];
}


export async function pplusFetchJson<T>(
    session: ParamountSession,
    apiPath: string,
    params?: Record<string, any>
): Promise<T> {
    const url = new URL(`${BASE_URL}/apps-api${apiPath}`);
    url.searchParams.set("at", AT_TOKEN_US);
    url.searchParams.set("locale", LOCALE_US);

    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue;
            url.searchParams.set(k, String(v));
        }
    }

    const res = await fetch(url.toString(), {
        headers: {
            "User-Agent":
                "Paramount+/15.5.0 (com.cbs.ott; androidphone) okhttp/5.1.0",
            "Accept": "application/json",
            "Cookie": cookieHeader(session.cookies),
        },
        cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    let json: any;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(`Paramount API non-JSON (${res.status}) ${apiPath}: ${text.slice(0, 200)}`);
    }

    if (!res.ok || json?.ok === false) {
        throw new Error(
            `Paramount API ${res.status} ${apiPath} ${json?.error ?? json?.message ?? text.slice(0, 200)}`
        );
    }

    return json as T;
}

// Token “at=...”: in EPlusTV è hardcoded. Qui lo teniamo uguale.
const TOKEN = [
    "A","B","C","v","v","U","1","P","v","0","B","R","R","9","a","W","Y","F","L","A","m","+","m","8","b","c","I","J","X","m","7","a","9","G","Y","p","M","w","X","F","t","D","u","q","1","P","5","A","R","A","g","6","o","6","0","y","i","l","K","8","o","Q","2","E","a","x","c","=",
].join("");

export type ParamountAuthStart = {
    deviceIdRaw: string;      // random hex (device_id in EPlusTV)
    deviceIdHashed: string;   // hashed_token in EPlusTV
    activationCode: string;   // codice da inserire
    deviceToken: string;      // token per polling
};

type ParamountUserProfile = { id: number; isMasterProfile: boolean };
type ParamountUser = { activeProfile: ParamountUserProfile; accountProfiles: ParamountUserProfile[] };

export class ParamountClient {
    private async getJson<T>(path: string, opts?: { cookies?: string[] }) : Promise<T> {
        const url = `${BASE_URL}${path}`;
        const res = await fetch(url, {
            method: "GET",
            headers: {
                ...(opts?.cookies?.length ? { Cookie: cookieHeader(opts.cookies) } : {}),
            },
            cache: "no-store",
        });
        if (!res.ok) throw new Error(`Paramount GET failed ${res.status}`);
        return await res.json() as T;
    }

    private async postJson<T>(path: string, body?: any, opts?: { cookies?: string[] }) : Promise<{ data: T; setCookies: string[] }> {
        const url = `${BASE_URL}${path}`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(opts?.cookies?.length ? { Cookie: cookieHeader(opts.cookies) } : {}),
            },
            body: body ? JSON.stringify(body) : "{}",
            cache: "no-store",
        });

        const setCookies = pickSetCookie(res.headers);
        if (!res.ok) throw new Error(`Paramount POST failed ${res.status}`);
        const data = await res.json() as T;
        return { data, setCookies };
    }

    /** START device auth: returns activationCode + deviceToken */
    async startDeviceAuth(): Promise<ParamountAuthStart> {
        // device_id = random hex 16
        const deviceIdRaw = crypto.randomBytes(32).toString("hex").slice(0, 16);

        // hashed_token = HMAC sha1 base64 substring(0,16) con secret 'eplustv' (come EPlusTV)
        const deviceIdHashed = crypto
            .createHmac("sha1", "eplustv")
            .update(deviceIdRaw)
            .digest("base64")
            .substring(0, 16);

        const qs = new URLSearchParams({ at: TOKEN, deviceId: deviceIdHashed }).toString();
        const path = `/apps-api/v2.0/androidtv/ott/auth/code.json?${qs}`;

        const { data } = await this.postJson<{ activationCode: string; deviceToken: string }>(path);

        return {
            deviceIdRaw,
            deviceIdHashed,
            activationCode: data.activationCode,
            deviceToken: data.deviceToken,
        };
    }

    /** Poll status: when success => returns cookies */
    async pollDeviceAuth(start: ParamountAuthStart): Promise<{ ok: boolean; cookies?: string[] }> {
        const qs = new URLSearchParams({
            activationCode: start.activationCode,
            at: TOKEN,
            deviceId: start.deviceIdHashed,
            deviceToken: start.deviceToken,
        }).toString();

        const path = `/apps-api/v2.0/androidtv/ott/auth/status.json?${qs}`;

        try {
            const { data, setCookies } = await this.postJson<{ success: boolean }>(path);
            if (!data.success) return { ok: false };
            if (!setCookies.length) throw new Error("Auth success but no set-cookie received");
            return { ok: true, cookies: setCookies };
        } catch {
            return { ok: false };
        }
    }

    async getAppConfig(session: ParamountSession): Promise<any> {
        const qs = new URLSearchParams({ at: TOKEN, locale: "en-us" }).toString();
        const path = `/apps-api/v2.0/androidphone/app/status.json?${qs}`;
        const data = await this.getJson<any>(path, { cookies: session.cookies });
        return data?.appConfig;
    }

    async getUser(session: ParamountSession): Promise<ParamountUser> {
        const qs = new URLSearchParams({ at: TOKEN, locale: "en-us" }).toString();
        const path = `/apps-api/v3.0/androidtv/login/status.json?${qs}`;
        return await this.getJson<ParamountUser>(path, { cookies: session.cookies });
    }

    async pickProfileId(session: ParamountSession): Promise<number> {
        const user = await this.getUser(session);
        if (user?.activeProfile?.id) return user.activeProfile.id;

        const master = user?.accountProfiles?.find(p => p.isMasterProfile);
        if (!master) throw new Error("No master profile found");
        return master.id;
    }

    /** “Refresh tokens” in EPlusTV = profile switch => new cookies */
    async refreshCookies(session: ParamountSession): Promise<ParamountSession> {
        if (!session.profileId) session.profileId = await this.pickProfileId(session);

        const qs = new URLSearchParams({ at: TOKEN, locale: "en-us" }).toString();
        const path = `/apps-api/v2.0/androidtv/user/account/profile/switch/${session.profileId}.json?${qs}`;

        const { setCookies } = await this.postJson<any>(path, {}, { cookies: session.cookies });
        if (setCookies.length) {
            session.cookies = setCookies;
            session.expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 365; // 1 anno (come EPlusTV)
        }
        return session;
    }

    /** Stream data: endpoint "irdeto-control/session-token" (attenzione: può essere DRM) */
    async getStreamData(session: ParamountSession, contentId: string): Promise<{ streamingUrl: string; ls_session?: string }> {
        const qs = new URLSearchParams({
            at: TOKEN,
            contentId,
            locale: "en-us",
        }).toString();

        const path = `/apps-api/v3.1/androidphone/irdeto-control/session-token.json?${qs}`;
        const data = await this.getJson<any>(path, { cookies: session.cookies });

        if (!data?.streamingUrl) throw new Error("No streamingUrl in response");
        return { streamingUrl: data.streamingUrl, ls_session: data.ls_session };
    }
}



