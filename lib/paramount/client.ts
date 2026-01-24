// lib/paramount/client.ts

import crypto from "crypto";
import {seal, unseal} from "@/lib/auth/jwe";
import {PPLUS_BASE_URL, PPLUS_AT_TOKEN_US, PPLUS_LOCALE_US, PPLUS_HEADER} from "@/lib/paramount/utils";

type ParamountUserProfile = { id: number; isMasterProfile: boolean };
type ParamountUser = { activeProfile: ParamountUserProfile; accountProfiles: ParamountUserProfile[] };

export type ParamountAuthStart = {
    deviceIdRaw: string;
    deviceIdHashed: string;
    activationCode: string;
    deviceToken: string;
    createdAt: string;
};

export type ParamountSession = {
    cookies: string[];
    expiresAt: number;
    profileId?: number|undefined;
};

export class ParamountClient {
    public session: ParamountSession | undefined;

    private async getJson<T>(
        apiPath: string,
        params?: Record<string, any>
    ): Promise<T> {

        const url = new URL(`${PPLUS_BASE_URL}/apps-api${apiPath}`);
        url.searchParams.set("at", PPLUS_AT_TOKEN_US);
        url.searchParams.set("locale", PPLUS_LOCALE_US);

        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v === undefined || v === null) continue;
                url.searchParams.set(k, String(v));
            }
        }

        const debug = process.env.DEBUG_PARAMOUNT === "1";
        if (debug) {
            console.log("[PPLUS] GET", apiPath);
            console.log("[PPLUS] URL", url.toString());
        }

        const res = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": PPLUS_HEADER,
                "Origin": PPLUS_BASE_URL,
                "Referer": PPLUS_BASE_URL,
                ...(this.session?.cookies?.length ? { Cookie: this.session.cookies.map((c) => c.split(";")[0]).join("; ") } : {}),
            },
            cache: "no-store",
        });

        const text = await res.text().catch(() => "");
        if (debug) {
            console.log("[PPLUS] Status", res.status);
            console.log("[PPLUS] Body first 300", text.slice(0, 300));
        }

        if (!res.ok) {
            throw new Error(`Paramount API ${res.status} ${apiPath} ${text.slice(0, 200)}`);
        }

        return JSON.parse(text) as T;
    }

    private async postJson<T>(
        apiPath: string,
        body?: any,
        params?: Record<string, any>
    ): Promise<{ data: T; cookies: string[] }> {

        const url = new URL(`${PPLUS_BASE_URL}/apps-api${apiPath}`);
        url.searchParams.set("at", PPLUS_AT_TOKEN_US);
        url.searchParams.set("locale", PPLUS_LOCALE_US);

        const bodyJson = body ? JSON.stringify(body) : "{}";

        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v === undefined || v === null) continue;
                url.searchParams.set(k, String(v));
            }
        }

        const debug = process.env.DEBUG_PARAMOUNT === "1";
        if (debug) {
            console.log("[PPLUS] POST", apiPath);
            console.log("[PPLUS] URL", url.toString());
            console.log("[PPLUS] BODY", bodyJson);
        }

        const res = await fetch(url.toString(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": PPLUS_HEADER,
                "Origin": PPLUS_BASE_URL,
                "Referer": PPLUS_BASE_URL,
                ...(this.session?.cookies?.length ? { Cookie: this.session.cookies.map((c) => c.split(";")[0]).join("; ") } : {}),
            },
            body: bodyJson,
            cache: "no-store",
        });

        const text = await res.text().catch(() => "");
        if (debug) {
            console.log("[PPLUS] Status", res.status);
            console.log("[PPLUS] Body first 300", text.slice(0, 300));
        }

        const cookies = this.pickSetCookie(res.headers);
        if (!res.ok) throw new Error(`Paramount POST failed ${res.status}`);
        const data = JSON.parse(text) as T;
        return { data, cookies };
    }

    /** Key session **/
    public async setSessionKey(key: string){
        if (!key) return null;

        let payload: any;
        try {
            payload = await unseal(key);
        } catch (err) {
            console.error("[session] invalid JWE key");
            return null;
        }

        if (!Array.isArray(payload.cookies) || payload.cookies.length === 0) {
            console.error("[session] missing cookies");
            return null;
        }
        if (typeof payload.expiresAt !== "number") {
            console.error("[session] missing expiresAt");
            return null;
        }
        if (Date.now() > payload.expiresAt) {
            console.warn("[session] session expired");
            return null;
        }

        this.session = {
            cookies: payload.cookies,
            expiresAt: payload.expiresAt,
            profileId: payload.profileId,
        };
    }

    public async setSession(session: ParamountSession){
        this.session = session;
        if(!this.session.profileId){
            this.session.profileId = await this.getMasterProfileId();
        }
    }

    public getSession(): ParamountSession|undefined {
        return this.session;
    }

    public async getSessionKey(): Promise<string>{
        return await seal(this.session ?? {
            cookies: [],
            expiresAt: null,
            profileId: null,
        });
    }

    private pickSetCookie(headers: Headers): string[] {
        const sc = typeof (headers as any).getSetCookie === "function" ? (headers as any).getSetCookie() : null;
        if (Array.isArray(sc) && sc.length) return sc;
        const single = headers.get("set-cookie");
        if (!single) return [];
        return [single];
    }

    /** Authentication ***/
    async startDeviceAuth(): Promise<ParamountAuthStart> {
        const deviceIdRaw = crypto.randomBytes(32).toString("hex").slice(0, 16);
        const deviceIdHashed = crypto
            .createHmac("sha1", "eplustv")
            .update(deviceIdRaw)
            .digest("base64")
            .substring(0, 16);

        const params = { deviceId: deviceIdHashed };
        const path = `/v2.0/androidtv/ott/auth/code.json`;

        const { data } = await this.postJson<any>(path, null, params);

        return {
            deviceIdRaw,
            deviceIdHashed,
            activationCode: data.activationCode,
            deviceToken: data.deviceToken,
            createdAt: Date.now().toString(),
        };
    }

    async pollDeviceAuth(start: ParamountAuthStart): Promise<{ ok: boolean; cookies?: string[] }> {
        const params = {
            activationCode: start.activationCode,
            deviceId: start.deviceIdHashed,
            deviceToken: start.deviceToken,
        };
        const path = `/v2.0/androidtv/ott/auth/status.json`;
        try {
            const { data, cookies } = await this.postJson<any>(path, {}, params);
            if (!data.success) return { ok: false };
            if (!cookies.length) throw new Error("Auth success but no set-cookie received");
            return { ok: true, cookies: cookies };
        } catch {
            return { ok: false };
        }
    }

    /** User Management **/
    async getUser(): Promise<ParamountUser> {
        const path = `/v3.0/androidtv/login/status.json`;
        return await this.getJson<any>(path);
    }

    async getMasterProfileId(): Promise<number> {
        const user = await this.getUser();
        if (user?.activeProfile?.id) return user.activeProfile.id;

        const master = user?.accountProfiles?.find(p => p.isMasterProfile);
        if (!master) throw new Error("No master profile found");
        return master.id;
    }

    async refreshCookies() {
        if(!this.session) return this.session;
        if (!this.session.profileId) this.session.profileId = await this.getMasterProfileId();

        const path = `/v2.0/androidtv/user/account/profile/switch/${this.session.profileId}.json`;
        const { cookies } = await this.postJson<any>(path);
        if (cookies.length) {
            this.session.cookies = cookies;
            this.session.expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 365; //1 Year
        }
        await this.setSession(this.session);
    }

    async getAppConfig(): Promise<any> {
        const path = `/v2.0/androidphone/app/status.json`;
        const data = await this.getJson<any>(path);
        return data?.appConfig;
    }

    /** Stream Management **/
    async getIrdetoSessionToken(contentId: string): Promise<any>{
        return await this.getJson<any>(
            "/v3.1/androidphone/irdeto-control/session-token.json",
            { contentId: contentId }
        );
    }

    /** Catalogs **/
    async getSportsLiveUpcoming(params: Record<string, any> = {}): Promise<any[]> {
        return await this.getJson<any>(
            "/v3.0/androidtv/hub/multi-channel-collection/live-and-upcoming.json",
            {
                platformType: "androidtv",
                rows: 300,
                start: 0,
                ...params,
            }
        );
    }

    async getLiveChannelListings(slug: string, params: Record<string, any> = {}): Promise<any> {
        return await this.getJson<any>(
            `/v3.0/androidphone/live/channels/${slug}/listings.json`,
            {
                rows: 125,
                start: 0,
                showListing: true,
                ...params,
            }
        );
    }

    async getFeaturedHome(): Promise<any[]> {
        return await this.getJson<any>("/v3.0/androidphone/home/configurator.json", {
            minProximity: 1,
            minCarouselItems: 1,
            maxCarouselItems: 25,
            rows: 50,
        });
    }

    async getCarouselItems(carouselId: string, params: Record<string, any>): Promise<any[]> {
        return this.getJson<any>(
            `/v3.0/androidphone/home/configurator/carousels/${carouselId}/items.json`,
            {
                _clientRegion: "US",
                platformType: "desktop",
                start: 0,
                rows: 200,
                ...params,
            }
        );
    }

    async getTrendingMovies(): Promise<any[]> {
        return await this.getJson<any>("/v3.0/androidphone/movies/trending.json");
    }

    async getTrendingShows(): Promise<any[]> {
        return await this.getJson<any>("/v3.0/androidphone/shows/trending.json");
    }

    async getSearch(term: string): Promise<any[]> {
        return await this.getJson<any>("/v3.0/androidphone/contentsearch/search.json", {
            term,
            rows: 50,
            start: 0,
            includeTrailerInfo: false,
            includeContentInfo: true,
            platformType: "androidphone",
            packageCode: "CBS_ALL_ACCESS_AD_FREE_PACKAGE",
        });
    }

    async getMovie(movieId: string): Promise<any[]> {
        return await this.getJson<any>(`/v3.0/androidphone/movies/${movieId}.json`);
    }

    async getShow(showId: string): Promise<any[]> {
        return await this.getJson<any>(`/v3.0/androidphone/shows/${showId}.json`);
    }

    async getShowsGroups(): Promise<any[]> {
        return await this.getJson<any>("/v2.0/androidphone/shows/groups.json");
    }

    async getShowsGroup(groupId: string): Promise<any[]> {
        return await this.getJson<any>(`/v2.0/androidphone/shows/group/${groupId}.json`, {
            rows: 50,
            begin: 0,
        });
    }

    async getMoviesGroups(): Promise<any[]> {
        return await this.getJson<any>("/v2.0/androidphone/movies/groups.json");
    }

    async getMoviesGroup(groupId: string): Promise<any[]> {
        return this.getJson<any>(`/v2.0/androidphone/movies/group/${groupId}.json`, {
            rows: 50,
            begin: 0,
        });
    }

    async getVideoSection(showId: string): Promise<any | null> {
        const data = await this.getJson<any>(
            `/v2.0/androidphone/shows/${showId}/videos/configuration.json`,
            {
                rows: 1,
                begin: 0,
            }
        );

        if (!data?.videoSectionMetadata || !data?.numFound) return null;

        const sections: any[] = data.videoSectionMetadata;
        const full = sections.find((s) => s?.section_type === "Full Episodes");
        return full ?? sections[sections.length - 1] ?? null;
    }

    async getSeasons(showId: string): Promise<number[]> {
        const data = await this.getJson<any>(
            `/v3.0/androidphone/shows/${showId}/video_available_season.json`
        );

        const list = data?.video_available_season?.itemList ?? [];
        const seasons = list
            .map(function(x: any){
                const n = Number(x?.seasonNum ?? x?.season_number ?? x?.season ?? x);
                return Number.isFinite(n) ? n : null;
            })
            .filter((n: number | null) => n !== null) as number[];

        return seasons.length ? Array.from(new Set(seasons)).sort((a, b) => a - b) : [];
    }

    async getEpisodes(section: any, season?: number): Promise<any[]> {
        const sectionId =
            section?.section_id ?? section?.sectionId ?? section?.id ?? section?.sectionID;
        if (!sectionId) return [];

        const params: Record<string, any> = { rows: 999, begin: 0 };

        if (season) {
            params.params = `seasonNum=${season}`;
            params.seasonNum = season;
        }

        const data = await this.getJson<any>(
            `/v2.0/androidphone/videos/section/${sectionId}.json`,
            params
        );

        return data?.sectionItems?.itemList ?? [];
    }
}


