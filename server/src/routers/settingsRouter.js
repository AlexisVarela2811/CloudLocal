const express = require('express');

function createSettingsRouter(settings, uploadDir) {
  const router = express.Router();
  const json = express.json({ limit: '16kb', type: 'application/json' });
  function jsonBody(req, res, next) {
    if (!req.is('application/json')) return res.status(415).json({ message: 'JSON required' });
    json(req, res, next);
  }

  router.get('/', async (req, res) => {
    const saved = await settings.load();
    const isActiveEnv = settings.getCurrentUploadDir() !== uploadDir;
    res.json({
      folderPath: saved ? saved.folderPath : null,
      activeFolderPath: settings.getCurrentUploadDir(),
      envOverride: !!process.env.CLOUDLOCAL_DATA_DIR,
      needsRestart: !!(saved && saved.folderPath !== settings.getCurrentUploadDir())
    });
  });

  router.put('/', jsonBody, async (req, res) => {
    const { folderPath } = req.body || {};
    if (!folderPath || typeof folderPath !== 'string') return res.status(400).json({ message: 'Valid folder path required' });
    try {
      await settings.validateNewPath(folderPath);
      await settings.save({ folderPath });
      res.json({ message: 'Carpeta guardada. Se aplicará al reiniciar.', needsRestart: true });
    } catch (error) {
      if (error.name === 'SettingsError') return res.status(400).json({ message: error.message });
      throw error;
    }
  });

  router.delete('/', async (req, res) => {
    await settings.clear();
    res.json({ message: 'Configuración de carpeta restablecida.' });
  });

  return router;
}

module.exports = { createSettingsRouter };