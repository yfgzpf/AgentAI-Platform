import crypto from 'crypto';
const store = new Map();
const TTL = 60000;
const MAX_BODY = 1024 * 1024;
export function generateKey(body) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    if (raw.length > MAX_BODY)
        throw new Error('Body too large for idempotency key');
    return crypto.createHash('sha256').update(raw).digest('hex');
}
export function start(key) {
    const existing = store.get(key);
    if (existing) {
        if (Date.now() - existing.createdAt > TTL) {
            store.delete(key);
        }
        else if (existing.status === 'in_progress') {
            return { ok: false, existing: { status: 'in_progress', message: 'Request already in progress' } };
        }
        else {
            return { ok: false, existing: existing.result };
        }
    }
    store.set(key, { key, result: null, createdAt: Date.now(), status: 'in_progress' });
    return { ok: true };
}
export function complete(key, result) {
    const entry = store.get(key);
    if (entry) {
        entry.status = 'completed';
        entry.result = result;
    }
}
export function fail(key) {
    store.delete(key);
}
export function cleanup() {
    const now = Date.now();
    for (const [k, v] of store) {
        if (now - v.createdAt > TTL)
            store.delete(k);
    }
}
