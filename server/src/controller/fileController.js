const fs = require('fs');
const path = require('path');
const {uploadFileService, listFilesService, deleteFileService, downloadFileService} = require('../service/fileService');

// Controlador para subir archivo
exports.uploadFile = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No hay archivos para subir, por favor sube un archivo.' });
      }
  
      if (typeof req.file !== 'object') {
        return res.status(400).json({ message: 'Formato de archivo no valido. Por favor, sube un archivo valido.' });
      }
      
      // Llamar al servicio para procesar el archivo
      const fileInfo = await uploadFileService(req.file);
  
      return res.status(201).json({
        message: 'Archivo subido correctamente!',
        file: fileInfo,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: 'Ocurrio un error inesperado.',
        error: error.message,
      });
    }
  };


//controllador para listar archivos
exports.listFiles = async (req, res) => {
    try {
        const files = await listFilesService();
        res.status(200).json({message: 'Archivos listados correctamente', files});
    } catch (error) {
        res.status(500).json({message: 'Error al listar los archivos', error: error.message});
    }
};

//contrallador para borrar archivos
exports.deleteFile = async (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename).trim();
        if (!filename) {
            return res.status(400).json({ message: 'No filename provided' });
        }
        await deleteFileService(filename);
        res.status(200).json({ message: 'Archivo borrado correctamente' });
    } catch (error) {
        res.status(500).json({ message: 'Error al borrar el archivo', error: error.message });
    }
};

//controllador para descargar archivos
exports.getFile = async (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename).trim();
        if (!filename) {
            return res.status(400).json({ message: 'No filename provided' });
        }

        // Usar el servicio para obtener el archivo como un stream
        const fileStream = await downloadFileService(filename);

        // Verificar si el archivo se puede leer 
        if (!fileStream || !fileStream.readable) {
            return res.status(500).json({ message: 'No se puede leer el archivo correctamente' });
        }

        // Configurar las cabeceras de la respuesta
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        // Descargar el archivo directamente
        res.status(200);
        fileStream.pipe(res); 
    } catch (error) {
        res.status(500).json({ message: 'Error al procesar la solicitud', error: error.message });
    }
};