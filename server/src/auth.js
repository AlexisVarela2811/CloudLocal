const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const derive = promisify(scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 1024;
const MAX_PEERS = 1024;
const MAX_CRYPTO_WAITERS = 32;
const error = (status, message) => Object.assign(new Error(message), { status });

function createAuth(stateDir, now = Date.now) {
    const file = path.join(stateDir, 'auth.json');
    const sessions = new Map();
    const attempts = new Map();
    let running = 0;
    const waiters = [];

    // Only accept the exact credential format we create. Any other on-disk state
    // fails closed rather than accidentally allowing a new initial setup.
    function credentials() {
        let text;
        try {
            const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid file');
            text = fs.readFileSync(file, 'utf8');
        } catch (cause) {
            if (cause.code === 'ENOENT') return null;
            throw new Error('Credenciales inválidas', { cause });
        }
        try {
            const value = JSON.parse(text);
            const base64 = (str, length) => typeof str === 'string' &&
                Buffer.from(str, 'base64').length === length &&
                Buffer.from(str, 'base64').toString('base64') === str;
            if (!value || value.version !== 1 || !base64(value.salt, 32) || !base64(value.hash, 64)) {
                throw new Error('invalid format');
            }
            return value;
        } catch (cause) {
            throw new Error('Credenciales inválidas', { cause });
        }
    }

    function clean(time) {
        for (const [token, expiry] of sessions) if (expiry <= time) sessions.delete(token);
        for (const [peer, record] of attempts) {
            record.failures = record.failures.filter(at => at > time - WINDOW_MS);
            if (record.failures.length === 0 && record.pending === 0) attempts.delete(peer);
        }
    }

    async function limitedDerive(password, salt) {
        if (running >= 2) {
            if (waiters.length >= MAX_CRYPTO_WAITERS) throw error(429, 'Demasiadas solicitudes');
            await new Promise(resolve => waiters.push(resolve));
        } else {
            running++;
        }
        try {
            return await derive(password, salt, 64);
        } finally {
            const next = waiters.shift();
            if (next) next(); // hand the occupied slot directly to the next waiter
            else running--;
        }
    }

    function checkPassword(password) {
        if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
            throw error(400, 'Contraseña inválida: se requieren entre 12 y 256 caracteres');
        }
    }

    // Check existing state at construction, including corrupt credentials.
    credentials();
    return {
        configured() {
            return credentials() !== null;
        },
        async setup(password) {
            checkPassword(password);
            if (credentials()) throw error(409, 'La configuración ya existe');
            const salt = randomBytes(32);
            const hash = await limitedDerive(password, salt);
            await fsp.mkdir(stateDir, { recursive: true, mode: 0o700 });
            let handle;
            try {
                handle = await fsp.open(file, 'wx', 0o600);
            } catch (cause) {
                if (cause.code === 'EEXIST') throw error(409, 'La configuración ya existe');
                throw cause;
            }
            let opened;
            try {
                opened = await handle.stat();
                await handle.writeFile(JSON.stringify({ version: 1, salt: salt.toString('base64'), hash: hash.toString('base64') }));
                await handle.sync();
                await handle.close();
            } catch (cause) {
                // Delete only the inode this setup created, never another writer's file.
                try {
                    const current = await fsp.lstat(file);
                    if (opened && opened.ino === current.ino && opened.dev === current.dev) await fsp.unlink(file);
                } catch { /* retain the original write error */ }
                await handle.close().catch(() => {});
                throw cause;
            }
        },
        async login(password, peer) {
            checkPassword(password);
            const key = typeof peer === 'string' && peer.length ? peer.slice(0, 256) : 'unknown';
            const time = now();
            clean(time);
            const record = attempts.get(key);
            if (record && record.failures.length + record.pending >= 5) throw error(429, 'Demasiados intentos');
            if (!record && attempts.size >= MAX_PEERS) throw error(429, 'Demasiados intentos');
            const entry = record || { failures: [], pending: 0 };
            if (!record) attempts.set(key, entry);
            entry.pending++;
            try {
                const stored = credentials();
                if (!stored) throw error(401, 'Credenciales incorrectas');
                const actual = await limitedDerive(password, Buffer.from(stored.salt, 'base64'));
                const expected = Buffer.from(stored.hash, 'base64');
                if (!timingSafeEqual(actual, expected)) {
                    entry.failures.push(now());
                    throw error(401, 'Credenciales incorrectas');
                }
                clean(now());
                if (sessions.size >= MAX_SESSIONS) throw error(429, 'Demasiadas sesiones');
                entry.failures.length = 0;
                const token = randomBytes(32).toString('hex');
                sessions.set(token, now() + SESSION_MS);
                return token;
            } finally {
                entry.pending--;
                if (!entry.pending && !entry.failures.length) attempts.delete(key);
            }
        },
        valid(token) {
            clean(now());
            // Disk corruption or removal revokes access even to an existing session.
            try {
                if (!credentials()) {
                    sessions.clear();
                    return false;
                }
            } catch {
                sessions.clear();
                return false;
            }
            return typeof token === 'string' && sessions.has(token);
        },
        logout(token) {
            sessions.delete(token);
        }
    };
}

module.exports = { createAuth };
