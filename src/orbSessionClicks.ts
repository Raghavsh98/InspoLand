/** Session-scoped orb link dedupe: same tab + refresh via sessionStorage, in-memory fallback. */

const SESSION_KEY = "fg-orb-clicked-urls";

let storageAvailable = true;
const clickedNormalized = new Set<string>();

function loadFromSessionStorage(): void {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) {
            return;
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return;
        }
        for (const item of parsed) {
            if (typeof item === "string") {
                clickedNormalized.add(normalizeOrbHref(item));
            }
        }
    } catch {
        storageAvailable = false;
    }
}

loadFromSessionStorage();

/** Canonical form for dedupe: absolute URL, no hash (fragment is not meaningful for these destinations). */
export function normalizeOrbHref(href: string): string {
    const raw = href.trim();
    try {
        const u = new URL(raw);
        u.hash = "";
        return u.href;
    } catch {
        return raw;
    }
}

function persist(): void {
    if (!storageAvailable) {
        return;
    }
    try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify([...clickedNormalized]));
    } catch {
        storageAvailable = false;
    }
}

export function isOrbUrlClickedThisSession(href: string): boolean {
    return clickedNormalized.has(normalizeOrbHref(href));
}

/** Call before opening the destination so the same link is not offered again this session. */
export function recordOrbUrlClickedThisSession(href: string): void {
    clickedNormalized.add(normalizeOrbHref(href));
    persist();
}

/** After every distinct inspiration URL has been opened once, start a new cycle (session tab only). */
export function clearOrbClickedSession(): void {
    clickedNormalized.clear();
    if (!storageAvailable) {
        return;
    }
    try {
        sessionStorage.removeItem(SESSION_KEY);
    } catch {
        storageAvailable = false;
    }
}

export function allInspirationUrlsClickedThisSession(urls: readonly string[]): boolean {
    const distinct = new Set(urls.map((u) => normalizeOrbHref(u)));
    for (const d of distinct) {
        if (!clickedNormalized.has(d)) {
            return false;
        }
    }
    return distinct.size > 0;
}
