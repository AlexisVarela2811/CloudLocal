const fs = require('fs');
const path = require('path');

//creamos la carpeta upload si no existe
const uploadDirectory = path.join(__dirname, '../upload');

if (!fs.existsSync(uploadDirectory)) {
    fs.mkdirSync(uploadDirectory, { recursive: true });
}

//servicio para subir archivos
exports.uploadFileService = (file) => {
    return new Promise((resolve) => {
        const fileInfo = {
            filename: file.filename,
            path: path.join(uploadDirectory, file.filename)
        };
        resolve(fileInfo);
    });
};

//servicio para listar archivos
exports.listFilesService = () => {
    return new Promise((resolve, reject) => {
        fs.readdir(uploadDirectory, (err, files) => {
            if (err) {
                reject(err);
            } else {
                resolve(files);
            }
        });
    });
};

//servicio para borrar archivos
exports.deleteFileService = (filename) => {
    return new Promise((resolve, reject) => {
        fs.readdir(uploadDirectory, (err, files) => {
            if (err) {
                return reject(err);
            }

            // Buscar el archivo sin distinguir mayúsculas y minúsculas
            const fileToDelete = files.find((file) => file.toLowerCase() === filename.toLowerCase());

            if (!fileToDelete) {
                return reject(new Error(`Archivo "${filename}" no encontrado`));
            }

            // Borrar el archivo encontrado
            const filePath = path.join(uploadDirectory, fileToDelete);
            fs.unlink(filePath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
};

//serivicio para descargar archivos
exports.downloadFileService = (filename) => {
    return new Promise((resolve, reject) => {
        const filePath = path.join(uploadDirectory, filename);
        
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`Archivo "${filename}" no encontrado`));
        }

        const fileStream = fs.createReadStream(filePath);
        resolve(fileStream);
    });
};
