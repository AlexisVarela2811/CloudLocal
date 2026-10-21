const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createAuth } = require('../src/auth');

test('single administrator uses salted password storage, expiring sessions and logout', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudlocal-auth-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let now = 1000;
    const auth = createAuth(root, () => now);
    assert.equal(auth.configured(), false);
    for (const invalid of ['short', 'x'.repeat(257), null]) {
        await assert.rejects(auth.setup(invalid), { status: 400 });
        assert.deepEqual(await fs.readdir(root), []);
        assert.equal(auth.configured(), false);
    }
    const competing = createAuth(root);
    const races = await Promise.allSettled([
        auth.setup('a secure passphrase'),
        competing.setup('a different passphrase')
    ]);
    assert.equal(races.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(races.filter(result => result.reason?.status === 409).length, 1);
    assert.equal(auth.configured(), true);
    assert.equal(competing.configured(), true);
    const stored = await fs.readFile(path.join(root, 'auth.json'), 'utf8');
    assert.equal(stored.includes('a secure passphrase'), false);
    assert.equal(stored.includes('a different passphrase'), false);
    const winner = races[0].status === 'fulfilled' ? 'a secure passphrase' : 'a different passphrase';
    await assert.rejects(auth.setup('replacement passphrase'), { status: 409 });
    assert.equal(await fs.readFile(path.join(root, 'auth.json'), 'utf8'), stored);
    await assert.rejects(auth.login('incorrect password', 'peer'), { status: 401 });
    const token = await auth.login(winner, 'peer');
    assert.equal(auth.valid(token), true);
    assert.equal(auth.valid(token + 'bad'), false);
    assert.equal(typeof await competing.login(winner, 'second peer'), 'string');
    auth.logout(token);
    assert.equal(auth.valid(token), false);
    assert.equal(auth.valid(null), false);
    const expired = await auth.login(winner, 'peer');
    now += 12 * 60 * 60 * 1000 - 1;
    assert.equal(auth.valid(expired), true);
    now += 1;
    assert.equal(auth.valid(expired), false);
    const restarted = createAuth(root);
    assert.equal(restarted.configured(), true);
    assert.equal(restarted.valid(expired), false);
    assert.equal((await fs.readFile(path.join(root, 'auth.json'), 'utf8')).includes('a secure passphrase'), false);
    if (process.platform !== 'win32') {
        assert.equal((await fs.stat(path.join(root, 'auth.json'))).mode & 0o777, 0o600);
    }
});

test('invalid login and concurrent attempts cannot bypass the peer limit', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudlocal-auth-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const auth = createAuth(root);
    await auth.setup('a secure passphrase');
    for (const invalid of ['', 'x'.repeat(257), null]) {
        await assert.rejects(auth.login(invalid, 'peer'), { status: 400 });
    }
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => auth.login('wrong password', 'peer')));
    assert.equal(attempts.filter(result => result.reason?.status === 401).length, 5);
    assert.equal(attempts.filter(result => result.reason?.status === 429).length, 1);
    await assert.rejects(auth.login('a secure passphrase', 'peer'), { status: 429 });
    assert.equal(typeof await auth.login('a secure passphrase', 'other peer'), 'string');
    assert.equal(await fs.readFile(path.join(root, 'auth.json'), 'utf8').then(text => text.includes('a secure passphrase')), false);
});

test('login failures are limited and malformed persisted credentials fail closed', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudlocal-auth-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let now = 1000;
    const auth = createAuth(root, () => now);
    await auth.setup('a secure passphrase');
    const stored = await fs.readFile(path.join(root, 'auth.json'), 'utf8');
    for (let i = 0; i < 5; i++) await assert.rejects(auth.login('wrong password', 'peer'), { status: 401 });
    await assert.rejects(auth.login('a secure passphrase', 'peer'), { status: 429 });
    await assert.rejects(auth.login('a secure passphrase', 'peer'), { status: 429 });
    assert.equal(await fs.readFile(path.join(root, 'auth.json'), 'utf8'), stored);
    const other = await auth.login('a secure passphrase', 'other peer');
    assert.equal(auth.valid(other), true);
    now += 15 * 60 * 1000 + 1;
    assert.equal(typeof await auth.login('a secure passphrase', 'peer'), 'string');
    await fs.writeFile(path.join(root, 'auth.json'), '{}');
    assert.throws(() => createAuth(root), /credenciales/i);
    await assert.rejects(auth.login('a secure passphrase', 'peer'), /credenciales/i);
    assert.equal(auth.valid(other), false);
    await fs.writeFile(path.join(root, 'auth.json'), stored);
    assert.equal(auth.valid(other), false);
});
