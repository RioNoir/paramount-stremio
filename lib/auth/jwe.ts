import { CompactEncrypt, compactDecrypt } from "jose";

function to32BytesKey(secret: string): Uint8Array {
    const data = new TextEncoder().encode(secret);
    return crypto.subtle.digest("SHA-256", data).then((buf) => new Uint8Array(buf)) as any;
}

async function getKeyBytes(): Promise<Uint8Array> {
    const secret = process.env.KEY_SECRET;
    if (!secret) throw new Error("Missing KEY_SECRET");
    return await to32BytesKey(secret);
}

export async function seal(payload: object): Promise<string> {
    const keyBytes = await getKeyBytes();
    // @ts-ignore
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);

    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = await new CompactEncrypt(plaintext)
        .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWE" })
        .encrypt(key as any);
    return Buffer.from(encrypted).toString("base64");
}

export async function unseal(token: string): Promise<object> {
    const keyBytes = await getKeyBytes();
    // @ts-ignore
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);

    const { plaintext } = await compactDecrypt(Buffer.from(token, 'base64').toString('utf-8'), key as any);
    const json = new TextDecoder().decode(plaintext);
    return JSON.parse(json);
}
