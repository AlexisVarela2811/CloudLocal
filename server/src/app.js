const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fileRouter = require('./routers/fileRouter');

// Cargamos las variables de entorno
dotenv.config();

const app = express();

// Configuramos el middleware cors
const permittedOrigins = process.env.ORIGINS.split(',');

app.use(cors({
    origin: function (origin, callback) {
        // acepta culquier origen de la lista de permitidos en el .env
        if (!origin) return callback(null, true);
        if (permittedOrigins.indexOf(origin) === -1) {
            const msg = 'El origen ' + origin + ' no está permitido';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'DELETE'],
}));

// Rutas de manejo de archivos
app.use('/api/files', fileRouter);

module.exports = app;