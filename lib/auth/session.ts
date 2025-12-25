// lib/auth/session.ts

import { unseal } from "./jwe";

/**
 * Questa è la struttura MINIMA della sessione
 * che serve al resto dell'app per parlare con Paramount.
 *
 * Se tu nel JWE hai più campi, puoi estenderla.
 */
export type ParamountSession = {
    cookies: string[];          // Set-Cookie salvati dopo login device
    expiresAt: number;          // timestamp ms
    userId?: number;
    profileId?: number;
    currentState?: string; // es: CBS_ALL_ACCESS_LOW_COST_PACKAGE
    sourceType?: string;   // es: SX
};

/**
 * Decodifica la key (JWE) passata nel PATH:
 *   /api/stremio/<KEY>/...
 *
 * Ritorna la sessione o null se:
 * - key non valida
 * - JWE non decifrabile
 * - sessione scaduta
 */
export async function readSessionFromKey(
    key: string
): Promise<ParamountSession | null> {
    if (!key || typeof key !== "string") {
        return null;
    }

    let payload: any;
    try {
        payload = await unseal(key);
    } catch (err) {
        console.error("[session] invalid JWE key");
        return null;
    }

    // Ci aspettiamo un payload tipo:
    // {
    //   kind: "session",
    //   cookies: [...],
    //   expiresAt: 1234567890,
    //   profileId?: number
    // }
    if (!payload || payload.kind !== "session") {
        console.error("[session] invalid payload kind");
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

    return {
        cookies: payload.cookies,
        expiresAt: payload.expiresAt,
        userId: payload.userId,
        profileId: payload.profileId,
        currentState: payload.currentState,
        sourceType: payload.sourceType,
    };
}
