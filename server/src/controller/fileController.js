const { media, legacyFile, filename } = require('../service/fileService');
const { buildZipArchive } = require('../storage');
const fsp = require('node:fs/promises');

const handle = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
const MOVE_MODES = new Set(['into']);
function moveMode(body) {
    if (body.mode === undefined) return undefined;
    if (typeof body.mode !== 'string' || !MOVE_MODES.has(body.mode)) {
        throw Object.assign(new Error('Invalid move mode'), { status: 400 });
    }
    return body.mode;
}
function controllers(storage, sse) {
    async function send(req, res, relative, inline = false) {
        const absolute = await storage.resolveFile(relative);
        const type = media(relative);
        const preview = inline && type !== 'application/octet-stream';
        res.setHeader('Content-Type', preview ? type : 'application/octet-stream');
        res.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(relative.split('/').at(-1))}`);
        if (preview) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        // Express sendFile implements conditional and byte-range responses for video.
        res.sendFile(absolute, { headers: { 'X-Content-Type-Options': 'nosniff' } }, error => {
            if (error && !res.headersSent) res.status(error.status || 404).json({ message: 'File unavailable' });
            else if (error) res.destroy();
        });
    }
    return {
        list: handle(async (req, res) => {
            const entries = await storage.list(req.query.folder === undefined ? '' : req.query.folder);
            if (req.query.q !== undefined && typeof req.query.q !== 'string') throw Object.assign(new Error('Invalid query'), { status: 400 });
            res.json({ entries: req.query.q ? entries.filter(e => e.name.toLowerCase().includes(req.query.q.toLowerCase())) : entries });
        }),
        folders: handle(async (req, res) => {
            const entry = await storage.mkdir(req.body.folder, req.body.name);
            sse.emit('folder', { path: entry.path, name: entry.name });
            res.status(201).json({ entry });
        }),        upload: handle(async (req, res) => {
            if (!req.file) throw Object.assign(new Error('File required'), { status: 400 });
            const entry = await storage.importFile(req.file.path, req.query.folder === undefined ? '' : req.query.folder, filename(req.file.originalname));
            sse.emit('upload', { path: entry.path, name: entry.name });
            res.status(201).json({ message: 'Archivo subido correctamente!', file: { filename: entry.name, path: entry.path } });
        }),        legacyList: handle(async (req, res) => res.json({ message: 'Archivos listados correctamente', files: (await storage.list()).filter(e => e.type === 'file').map(e => e.name) })),
        legacyDownload: handle(async (req, res) => send(req, res, await legacyFile(storage, req.params.filename))),
        legacyDelete: handle(async (req, res) => {
            await storage.trash(await legacyFile(storage, req.params.filename, true));
            res.json({ message: 'Archivo borrado correctamente' });
        }),
        content: handle(async (req, res) => send(req, res, req.query.path, req.query.inline === '1')),
        trash: handle(async (req, res) => {
            const entry = await storage.trash(req.query.path);
            sse.emit('trash', { path: entry.path, name: entry.name });
            res.json({ entry });
        }),
        listTrash: handle(async (req, res) => res.json({ entries: await storage.listTrash() })),
        restore: handle(async (req, res) => {
            const entry = await storage.restore(req.params.id);
            sse.emit('restore', { path: entry.path, name: entry.name });
            res.json({ entry });
        }),        status: handle(async (req, res) => res.json({ storage: await storage.usage(), maxUploadBytes: req.app.locals.maxUploadBytes, urls: req.app.locals.urls || [], warning: 'HTTP on a local network is not encrypted.' })),
        move: handle(async (req, res) => {
            const { from, to } = req.body || {};
            if (!from || typeof from !== 'string') throw Object.assign(new Error('Missing from path'), { status: 400 });
            if (typeof to !== 'string') throw Object.assign(new Error('Missing to folder'), { status: 400 });
            const mode = moveMode(req.body || {});
            let entry;
            if (mode === 'into') {
                await storage.list(to);
                try {
                    await storage.list(from);
                    entry = await storage.moveFolder(from, to);
                } catch (cause) {
                    if (cause.status === 409) throw cause;
                    entry = await storage.move(from, to);
                }
                sse.emit('move', { from, to, path: entry.path, name: entry.name });
                res.json({ success: true, entry });
                return;
            }
            try {
                await storage.list(to);
                try {
                    await storage.list(from);
                    entry = await storage.moveFolder(from, to);
                } catch {
                    entry = await storage.move(from, to);
                }
            } catch (cause) {
                if (cause.status === 409) throw cause;
                const slashIndex = to.lastIndexOf('/');
                const parentFolder = slashIndex > 0 ? to.slice(0, slashIndex) : '';
                const newName = slashIndex > 0 ? to.slice(slashIndex + 1) : to;
                entry = await storage.move(from, parentFolder, newName);
            }
            sse.emit('move', { from, to, path: entry.path, name: entry.name });
            res.json({ success: true, entry });
        }),
        moveFolder: handle(async (req, res) => {
            const { from, to } = req.body || {};
            if (!from || typeof from !== 'string') throw Object.assign(new Error('Missing from path'), { status: 400 });
            if (typeof to !== 'string') throw Object.assign(new Error('Missing to folder'), { status: 400 });
            const mode = moveMode(req.body || {});
            if (mode === 'into') await storage.list(to);
            const entry = await storage.moveFolder(from, to);
            sse.emit('move', { from, to, path: entry.path, name: entry.name });
            res.json({ success: true, entry });
        }),
        copy: handle(async (req, res) => {
            const { from, to, newName } = req.body || {};
            if (!from || typeof from !== 'string') throw Object.assign(new Error('Missing from path'), { status: 400 });
            if (!to || typeof to !== 'string') throw Object.assign(new Error('Missing to folder'), { status: 400 });
            const entry = await storage.copy(from, to, newName);
            sse.emit('copy', { from, to, path: entry.path, name: entry.name });
            res.json({ success: true, entry });
        }),
        paste: handle(async (req, res) => {
            const { from, to, type } = req.body || {};
            if (!from || typeof from !== 'string') throw Object.assign(new Error('Missing from path'), { status: 400 });
            if (!to || typeof to !== 'string') throw Object.assign(new Error('Missing to folder'), { status: 400 });
            if (type !== 'folder' && type !== 'file') throw Object.assign(new Error('Missing or invalid type'), { status: 400 });
            let entry;
            if (type === 'folder') {
                entry = await storage.copyFolder(from, to);
            } else {
                entry = await storage.copy(from, to);
            }
            sse.emit('paste', { from, to, path: entry.path, name: entry.name });
            res.json({ success: true, entry });
        }),
        permanentDelete: handle(async (req, res) => {
            const { id } = req.body || {};
            if (!id || typeof id !== 'string') throw Object.assign(new Error('Missing id'), { status: 400 });
            const result = await storage.permanentDelete(id);
            sse.emit('permanent-delete', { id });
            res.json({ success: true, ...result });
        }),
        emptyTrash: handle(async (req, res) => {
            const result = await storage.emptyTrash();
            sse.emit('empty-trash', { count: result.count });
            res.json({ success: true, ...result });
        }),        zipDownload: handle(async (req, res) => {
            const paths = req.query.paths;
            if (!paths) throw Object.assign(new Error('Missing paths'), { status: 400 });
            const pathList = Array.isArray(paths) ? paths : [paths];
            if (pathList.length === 0) throw Object.assign(new Error('Empty paths'), { status: 400 });
            // Collect file entries: { name, data }
            const files = [];
            for (const rel of pathList) {
                if (typeof rel !== 'string' || !rel) throw Object.assign(new Error('Invalid path'), { status: 400 });
                try {
                    const data = await fsp.readFile(await storage.resolveFile(rel));
                    files.push({ name: rel, data });
                } catch {
                    // File not found, skip
                }
            }
            if (files.length === 0) throw Object.assign(new Error('No files to zip'), { status: 404 });
            const archive = await buildZipArchive(files);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'cloudlocal.zip');
            res.setHeader('Content-Length', archive.length);
            res.send(archive);
        }),
        imagePreview: handle(async (req, res) => {
            const relativePath = req.params[0] || req.params['*'];
            if (!relativePath || typeof relativePath !== 'string') throw Object.assign(new Error('Invalid path'), { status: 400 });
            const { media } = require('../service/fileService');
            const contentType = media(relativePath);
            if (!contentType.startsWith('image/')) throw Object.assign(new Error('Not an image'), { status: 400 });
            const absolute = await storage.resolveFile(relativePath);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.sendFile(absolute, { headers: { 'X-Content-Type-Options': 'nosniff' } }, error => {
                if (error && !res.headersSent) res.status(404).json({ message: 'Image unavailable' });
            });
        })
    };
}
module.exports = { controllers, handle };
