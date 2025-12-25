import { CompactEncrypt, compactDecrypt } from "jose";

function to32BytesKey(secret: string): Uint8Array {
    // Ricava una chiave 32-byte stabile da una stringa (semplice e sufficiente qui).
    // Usiamo SHA-256 del secret.
    const data = new TextEncoder().encode(secret);

    // WebCrypto su Node 20 è disponibile come globalThis.crypto
    // (su Next/Vercel va bene).
    // Se mai non lo fosse, dimmelo e mettiamo fallback.
    return crypto.subtle.digest("SHA-256", data).then((buf) => new Uint8Array(buf)) as any;
}

async function getKeyBytes(): Promise<Uint8Array> {
    const secret = process.env.APP_KEY_SECRET;
    if (!secret) throw new Error("Missing APP_KEY_SECRET");
    return await to32BytesKey(secret);
}

export type PendingPayload = {
    kind: "pending";
    createdAt: number;
    deviceIdRaw: string;
    deviceIdHashed: string;
    activationCode: string;
    deviceToken: string;
};

export type SessionPayload = {
    kind: "session";
    createdAt: number;
    expiresAt: number;
    cookies: string[];
    profileId?: number;
    // evita roba enorme nel token: appConfig spesso è grande
};

export type AnyPayload = PendingPayload | SessionPayload;

export async function seal(payload: { kind: string; ls_session: string; exp: number }): Promise<string> {
    const keyBytes = await getKeyBytes();
    // @ts-ignore
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);

    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    return await new CompactEncrypt(plaintext)
        .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWE" })
        .encrypt(key as any);
}

export async function unseal(token: string): Promise<AnyPayload> {
    const keyBytes = await getKeyBytes();
    // @ts-ignore
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);

    const { plaintext } = await compactDecrypt(token, key as any);
    const json = new TextDecoder().decode(plaintext);
    return JSON.parse(json) as AnyPayload;
}
