"use client";

import { useEffect, useMemo, useState } from "react";

function Button({
    children,
    onClick,
    disabled,
    variant = "primary",
    type = "button",
}: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: "primary" | "secondary";
    type?: "button" | "submit";
}) {
    const base =
        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2";
    const styles =
        variant === "primary"
            ? "bg-black text-white hover:bg-black/85 focus:ring-black disabled:bg-black/40"
            : "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-300 disabled:bg-gray-100/60";
    return (
        <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
            {children}
        </button>
    );
}

function Input({
   value,
   onChange,
   placeholder,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) {
    return (
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
    );
}

function TextArea({
  value,
  readOnly = false,
}: {
    value: string;
    readOnly?: boolean;
}) {
    return (
        <textarea
            value={value}
            readOnly={readOnly}
            className="min-h-[90px] w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
    );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
            </div>
            {children}
        </div>
    );
}

async function copyToClipboard(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

export default function ConfigurePage() {
    const [activationCode, setActivationCode] = useState<string | null>(null);
    const [pendingToken, setPendingToken] = useState<string | null>(null);
    const [manifestUrl, setManifestUrl] = useState<string | null>(null);
    const [key, setKey] = useState("");
    const [toast, setToast] = useState<string | null>(null);

    async function start() {
        setActivationCode(null);
        setPendingToken(null);
        setManifestUrl(null);

        const r = await fetch("/api/auth/device/start", { method: "POST" });
        const j = await r.json();

        if (!r.ok) {
            showToast(j?.error ?? "Error");
            return;
        }

        setActivationCode(j.activationCode);
        setPendingToken(j.pendingToken);
    }

    async function pollOnce(token: string) {
        const r = await fetch("/api/auth/device/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: token }),
        });
        const j = await r.json();
        if (j.ok) {
            setManifestUrl(j.manifestUrl);
            return true;
        }
        return false;
    }

    useEffect(() => {
        if (!pendingToken || manifestUrl) return;

        const t = setInterval(async () => {
            try {
                const ok = await pollOnce(pendingToken);
                if (ok) clearInterval(t);
            } catch {}
        }, 3000);

        return () => clearInterval(t);
    }, [pendingToken, manifestUrl]);

    // opzionale: se vuoi leggere la key dalla query (?key=...)
    useEffect(() => {
        const url = new URL(window.location.href);
        const q = url.searchParams.get("key");
        if (q && !key) setKey(q);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const origin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);

    const stremioInstallUrl = useMemo(() => {
        // Stremio supporta install tramite URL. In molti casi basta incollare manifestUrl nell’app.
        // Qui ti lasciamo anche un link “apri stremio” che spesso funziona su desktop.
        if (!manifestUrl) return "";
        return `stremio://` + manifestUrl;
    }, [manifestUrl]);

    const debugFeaturedUrl = useMemo(() => {
        if (!origin || !key) return "";
        return `${origin}/api/debug/paramount?endpoint=carousels&key=${encodeURIComponent(key)}`;
    }, [origin, key]);

    const debugSportsUrl = useMemo(() => {
        if (!origin || !key) return "";
        return `${origin}/api/debug/paramount-sports?limit=2&pretty=1&key=${encodeURIComponent(key)}`;
    }, [origin, key]);

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 1800);
    }

    async function onCopyManifest() {
        if (!manifestUrl) return;
        const ok = await copyToClipboard(manifestUrl);
        showToast(ok ? "Manifest URL copiato ✅" : "Impossibile copiare 😅");
    }

    async function onCopyKey() {
        if (!key) return;
        const ok = await copyToClipboard(key);
        showToast(ok ? "Key copiata ✅" : "Impossibile copiare 😅");
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="mx-auto w-full max-w-4xl px-4 py-10">
                <div className="mb-8">
                    <div className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700">
                        Paramount+ (US) → Stremio Addon
                    </div>
                    <h1 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">
                        Configure Addon
                    </h1>
                    <p className="mt-2 text-sm text-gray-600">
                        Log in to Paramount+ and get the link to your add-on.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Card
                        title="1 → Sign in to Paramount+"
                        subtitle="Login with device code."
                    >
                        <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                                {!activationCode && (
                                    <Button onClick={start} variant="secondary">
                                        Start login (device code)
                                    </Button>
                                )}
                            </div>

                            {activationCode && !manifestUrl && (
                                <div className="mt-5 text-black">
                                    <p>
                                        Go <a href="https://www.paramountplus.com/activate/androidtv/" target="_blank" rel="noreferrer" className="text-blue-400">
                                        here
                                    </a> and insert:
                                    </p>
                                    <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 6 }}>
                                        {activationCode}
                                    </div>
                                    <p style={{ opacity: 0.8 }}>I am automatically checking every 3 seconds...</p>
                                </div>
                            )}

                            {manifestUrl && (
                                <div className="text-center text-2xl">
                                    <h3 className="text-black font-bold">✅</h3>
                                    <h3 className="font-bold text-teal-700">Logged in</h3>
                                </div>
                            )}
                        </div>
                    </Card>

                    <Card
                        title="2 → Install to Stremio"
                        subtitle="Copy the manifest URL and paste it into Stremio → Addons → Community → Install via URL."
                    >
                        <div className="space-y-3">
                            <TextArea value={manifestUrl || "Login to generate the manifest URL..."} readOnly />
                            <div className="flex flex-wrap gap-2">
                                <Button onClick={onCopyManifest} disabled={!manifestUrl}>
                                    Copy Manifest URL
                                </Button>

                                <a
                                    href={stremioInstallUrl || "#"}
                                    onClick={(e) => !stremioInstallUrl && e.preventDefault()}
                                    className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition ${
                                        stremioInstallUrl
                                            ? "bg-gray-100 text-gray-900 hover:bg-gray-200"
                                            : "bg-gray-100/60 text-gray-500 cursor-not-allowed"
                                    }`}
                                >
                                    Open in Stremio
                                </a>
                            </div>
                        </div>
                    </Card>
                </div>

                {toast ? (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black px-4 py-2 text-sm text-white shadow-lg">
                        {toast}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
