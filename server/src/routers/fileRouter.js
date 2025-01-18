const express = require('express');
const multer = require('multer');
const fileController = require('../controller/fileController');
const path = require('path');

//settings multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../upload'));
    },
    filename: function (req, file, cb) {
        console.log('Archivo:', file); 
        cb(null, file.originalname)
    }
});
const upload = multer({ storage: storage });

//creamos un router y asignamos las rutas
const router = express.Router();

//ruta para subir un archivo
router.post('/upload', upload.single('file'), fileController.uploadFile);


//ruta para listar los archivo
router.get('/list', fileController.listFiles);

//ruta para borrar un archivo
router.delete('/delete/:filename', fileController.deleteFile);

//ruta para descargar un archivo
router.get('/download/:filename', fileController.getFile);


module.exports = router;