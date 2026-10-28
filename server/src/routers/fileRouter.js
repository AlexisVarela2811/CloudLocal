const express = require('express');
const multer = require('multer');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { controllers } = require('../controller/fileController');

function fileRouter(storage, maxUploadBytes, sse) {    const router = express.Router();
    const actions = controllers(storage, sse);
    const json = express.json({ limit: '16kb', type: 'application/json' });
    function jsonBody(req, res, next) {
        if (!req.is('application/json')) return res.status(415).json({ message: 'JSON required' });
        json(req, res, next);
    }
    const forbiddenExts = new Set(['exe', 'bat', 'cmd', 'scr', 'vbs', 'js', 'ps1', 'reg']);
    let active = 0;
    const upload = multer({
        storage: multer.diskStorage({
            destination: storage.tempDir,
            filename(req, file, callback) {
                const target = randomUUID();
                req.uploadTemps.push(path.join(storage.tempDir, target));
                callback(null, target);
            }
        }),
        limits: { fileSize: maxUploadBytes, files: 1, fields: 0, parts: 1 },
        fileFilter(req, file, callback) {
            const ext = path.extname(file.originalname).slice(1).toLowerCase();
            if (ext && forbiddenExts.has(ext)) {
                return callback(Object.assign(new Error('File type not allowed'), { status: 400 }));
            }
            callback(null, true);
        }
    }).single('file');
    router.post('/upload', (req, res, next) => {
        if (active >= 4) return res.status(429).json({ message: 'Too many uploads' });
        active++;
        req.uploadTemps = [];
        res.once('close', () => {
            active--;
            for (const target of req.uploadTemps) fs.unlink(target).catch(error => {
                if (error.code !== 'ENOENT') console.error('Temporary upload cleanup failed');
            });
        });
        upload(req, res, error => {
            if (error) return next(error);
            actions.upload(req, res, next);
        });
    });
    router.get('/list', actions.legacyList);
    router.get('/download/:filename', actions.legacyDownload);
    router.delete('/delete/:filename', actions.legacyDelete);
    router.get('/content', actions.content);
    router.get('/', actions.list);
    router.delete('/', actions.trash);
    router.post('/move', jsonBody, actions.move);
    router.post('/moveFolder', jsonBody, actions.moveFolder);
    router.post('/copy', jsonBody, actions.copy);
    router.post('/paste', jsonBody, actions.paste);
    router.post('/permanent', jsonBody, actions.permanentDelete);
    router.get('/zip', actions.zipDownload);
    router.get('/preview/*', actions.imagePreview);
    return router;
}

module.exports = { fileRouter };
