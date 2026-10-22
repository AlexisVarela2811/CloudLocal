const { media, legacyFile, filename } = require('../service/fileService');
const { buildZipArchive } = require('../storage');
const fsp = require('node:fs/promises');

const handle = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
function controllers(storage) {
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
        folders: handle(async (req, res) => res.status(201).json({ entry: await storage.mkdir(req.body.folder, req.body.name) })),
        upload: handle(async (req, res) => {
            if (!req.file) throw Object.assign(new Error('File required'), { status: 400 });
            const entry = await storage.importFile(req.file.path, req.query.folder === undefined ? '' : req.query.folder, filename(req.file.originalname));
            res.status(201).json({ message: 'Archivo subido correctamente!', file: { filename: entry.name, path: entry.path } });
        }),
        legacyList: handle(async (req, res) => res.json({ message: 'Archivos listados correctamente', files: (await storage.list()).filter(e => e.type === 'file').map(e => e.name) })),
        legacyDownload: handle(async (req, res) => send(req, res, await legacyFile(storage, req.params.filename))),
        legacyDelete: handle(async (req, res) => {
            await storage.trash(await legacyFile(storage, req.params.filename, true));
            res.json({ message: 'Archivo borrado correctamente' });
        }),
        content: handle(async (req, res) => send(req, res, req.query.path, req.query.inline === '1')),
        trash: handle(async (req, res) => res.json({ entry: await storage.trash(req.query.path) })),
        listTrash: handle(async (req, res) => res.json({ entries: await storage.listTrash() })),
        restore: handle(async (req, res) => res.json({ entry: await storage.restore(req.params.id) })),
        status: handle(async (req, res) => res.json({ storage: await storage.usage(), maxUploadBytes: req.app.locals.maxUploadBytes, urls: req.app.locals.urls || [], warning: 'HTTP on a local network is not encrypted.' })),
        move: handle(async (req, res) => {
            const { from, to } = req.body || {};
            if (!from || typeof from !== 'string') throw Object.assign(new Error('Missing from path'), { status: 400 });
            if (!to || typeof to !== 'string') throw Object.assign(new Error('Missing to folder'), { status: 400 });
            try {
                await storage.list(from);
                const entry = await storage.moveFolder(from, to);
                res.json({ success: true, entry });
            } catch (cause) {
                const entry = await storage.move(from, to);
                res.json({ success: true, entry });
            }
        }),
        moveFolder: handle(async (req, res) => {
            const { from, to } = req.body || {};
            if (!from || typeof from !== 'string') throw Object.assign(new Error('Missing from path'), { status: 400 });
            if (!to || typeof to !== 'string') throw Object.assign(new Error('Missing to folder'), { status: 400 });
            const entry = await storage.moveFolder(from, to);
            res.json({ success: true, entry });
        }),
        copy: handle(async (req, res) => {
            const { from, to, newName } = req.body || {};
            if (!from || typeof from !== 'string') throw Object.assign(new Error('Missing from path'), { status: 400 });
            if (!to || typeof to !== 'string') throw Object.assign(new Error('Missing to folder'), { status: 400 });
            const entry = await storage.copy(from, to, newName);
            res.json({ success: true, entry });
        }),
        paste: handle(async (req, res) => {
            const { from, to, type } = req.body || {};
            if (!from || typeof from !== 'string') throw Object.assign(new Error('Missing from path'), { status: 400 });
            if (!to || typeof to !== 'string') throw Object.assign(new Error('Missing to folder'), { status: 400 });
            if (type !== 'folder' && type !== 'file') throw Object.assign(new Error('Missing or invalid type'), { status: 400 });
            if (type === 'folder') {
                const entry = await storage.copyFolder(from, to);
                res.json({ success: true, entry });
            } else {
                const entry = await storage.copy(from, to);
                res.json({ success: true, entry });
            }
        }),
        permanentDelete: handle(async (req, res) => {
            const { id } = req.body || {};
            if (!id || typeof id !== 'string') throw Object.assign(new Error('Missing id'), { status: 400 });
            const result = await storage.permanentDelete(id);
            res.json({ success: true, ...result });
        }),
        emptyTrash: handle(async (req, res) => {
            const result = await storage.emptyTrash();
            res.json({ success: true, ...result });
        }),
        zipDownload: handle(async (req, res) => {
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
