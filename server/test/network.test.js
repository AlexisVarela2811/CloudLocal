const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isLoopback, isPrivatePeer, validHost, originMatches, urlsFor } = require('../src/network');

test('peer, host, origin and advertised URLs stay LAN-only and truthful', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(address), true);
    for (const address of ['192.168.1.8', '10.0.0.1', '172.16.1.9', 'fe80::1']) assert.equal(isPrivatePeer(address), true);
    for (const address of ['8.8.8.8', '172.32.0.1', '2001:4860::1', '::ffff:8.8.8.8']) assert.equal(isPrivatePeer(address), false);
    for (const host of ['localhost:5000', '127.0.0.1', '[::1]:5000', 'cloudlocal.local', '192.168.1.10:5000']) assert.equal(validHost(host), true);
    for (const host of ['evil.example', '8.8.8.8', 'cloudlocal.local.evil.example', 'user@localhost', 'localhost:bad']) assert.equal(validHost(host), false);
    assert.equal(originMatches('http://localhost:5000', 'localhost:5000'), true);
    assert.equal(originMatches('http://localhost:6000', 'localhost:5000'), false);
    assert.equal(originMatches('https://localhost:5000', 'localhost:5000'), false);
    assert.deepEqual(urlsFor(5000, ['192.168.1.10']), ['http://127.0.0.1:5000', 'http://192.168.1.10:5000']);
});
