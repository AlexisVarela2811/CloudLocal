const app = require('./app');
const port = process.env.PORT;
const host = process.env.HOST;

app.listen(port, host, () => {
    console.log(`Servidor corriendo en el puerto ${port} en ${host}`);
});