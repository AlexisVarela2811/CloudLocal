# Servidor Portable y Configuración

## CloudLocal.exe — Cómo funciona

CloudLocal.exe es un ejecutable autocontenido construido con **Node.js SEA** (Single-Executable Application). Incluye:

1. **El servidor Node.js** (HTTP API + frontend estático)
2. **El cliente web** (React build)
3. **El módulo tray** (notificaciones y apertura automática del navegador)

> **Node.js SEA** es la capacidad de Node.js para embeber un blob de assets y un script principal dentro de un ejecutable. No es "Secure Node" ni Node.js seguro; es simplemente un empaquetador. La firma Authenticode es opcional (el script de construcción no la aplica). El binario heredado de `node.exe` puede conservar una firma heredada del paquete `node-win-x64` que Windows puede rechazar con un aviso de "inherited signature". CloudLocal no realiza ninguna firma de confianza propia.

## Instalación

### Windows

1. Descarga `launcher/dist/CloudLocal.exe` (construido en un equipo Windows x64)
2. Haz doble clic para ejecutarlo
3. La primera vez Windows puede bloquearlo — clic en **"Más información" → "Ejecutar de todos modos"**
4. El servidor se ejecuta en segundo plano, sin consola (subsystem=2, GUI)
5. Se abre el navegador automáticamente y se muestra una notificación toast

### Configuración inicial

La primera vez que ejecutas CloudLocal:

1. Abre `http://localhost:80` (o el puerto configurado)
2. Verás la pantalla de **Acceso** con campo de contraseña
3. Configura una contraseña de entre 12 y 256 caracteres
4. Guarda la contraseña en un gestor seguro (es la única forma de entrar después)

## Detener y reiniciar

1. Espera a que finalicen las subidas y descargas.
2. En la interfaz web, pulsa **Detener Server** con la sesión iniciada. Se cierra la instancia que atiende esa dirección y termina su proceso, no los demás procesos de Node. Si abriste varias instancias, las otras siguen ejecutándose.
3. Para reiniciar, vuelve a ejecutar `CloudLocal.exe` y recarga la página. Los archivos y la contraseña se conservan; el botón vuelve a habilitarse cuando la app conecta con el servidor.

El cierre espera hasta tres segundos a que drenen las conexiones antes de terminar el proceso. Una transferencia aún activa puede interrumpirse.

## Puertos

Por defecto, CloudLocal usa el puerto **5000** (server standalone) o **80** (launcher).

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `CLOUDLOCAL_PORT` | `5000` | Puerto HTTP principal |
| `PORT` | `5000` | Alternativa (solo server standalone) |
| `CLOUDLOCAL_FALLBACK_PORT` | `5000` | Puerto de respaldo si el principal falla |
| `HOST` | `0.0.0.0` | Interfaz a escuchar (`0.0.0.0` = todas, `127.0.0.1` = solo localhost) |

> El launcher (`CloudLocal.exe`) fija automáticamente `CLOUDLOCAL_PORT=80`. No se necesita configurar.

## Carpeta de almacenamiento

Los archivos se almacenan en `.cloudlocal/files/` dentro del directorio de usuario (normalmente `C:\Users\<usuario>\.cloudlocal\files\`).

Puedes cambiar la carpeta desde la UI en **Configuración → Cambiar carpeta**.

### Variables de entorno de almacenamiento

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `CLOUDLOCAL_DATA_DIR` | `.cloudlocal/files` | Carpeta donde se almacenan los archivos |
| `CLOUDLOCAL_STATE_DIR` | `.cloudlocal/state` | Carpeta de estado y credenciales (auth.json) |

## Seguridad

- **Contraseña**: se almacena en `C:\Users\<usuario>\.cloudlocal\state\auth.json` con hash scrypt (32-byte salt, 64-byte hash)
- **Cookie de sesión**: `cloudlocal_session` (HttpOnly, SameSite=Strict, 12 h)
- **HTTP vs HTTPS**: CloudLocal no soporta HTTPS nativo. Si necesitas cifrado, usa un proxy inverso (nginx, Caddy) delante del puerto.
- **Acceso LAN**: cualquier dispositivo en la misma red puede acceder a `http://<IP-SERVIDOR>:<puerto>`. Configura un firewall si solo quieres acceso local.
- **Origen local**: el servidor rechaza peticiones de hosts no privados y valida el `Origin` header contra el `Host`.

## Solución de problemas

### No se puede ejecutar CloudLocal.exe

- Windows puede pedir "Ejecutar de todos modos" en la primera ejecución.
- Si falló la construcción, asegúrate de tener Node.js 22+ instalado y ejecutar `npm ci --prefix launcher` en el equipo Windows x64 donde se construye.
- El ejecutable puede mostrar un aviso de firma heredada del paquete `node-win-x64`. CloudLocal no realiza ninguna firma Authenticode propia. No se puede verificar la firma desde PowerShell en este entorno (módulo `System.Security.Cryptography.Pkcs` no disponible).

### No arranca el servidor

- Verifica que el puerto no lo esté usando otro programa (IIS, Skype, VPN).
- Cambia `CLOUDLOCAL_PORT` a otro valor (ej. `8080`) o `CLOUDLOCAL_FALLBACK_PORT` a un puerto alternativo.

### Los archivos no aparecen

- Verifica que la carpeta `.cloudlocal/files/` existe y tiene permisos de escritura.
- Reinicia el servidor después de cambiar la carpeta desde la UI.

## Ejecución desde código fuente

### Construcción

```sh
# Instalar dependencias (workspace + launcher)
npm ci
npm ci --prefix launcher

# Compilar frontend
npm run build:frontend

# Construir ejecutable
npm run build:exe
```

El script `launcher/scripts/build.cjs`:

1. Empaqueta `client/dist` como assets SEA
2. Compila `launcher/src/main.cjs` con esbuild (bundle CJS, target node22)
3. Genera `sea.json` y `sea.blob` con `node --experimental-sea-config`
4. Copia `node.exe` → `CloudLocal.exe` e inyecta el blob con `postject`
5. Cambia el subsystem PE de 3 (CONSOLE) a 2 (GUI) para ocultar la consola

### Lanzar en desarrollo

```sh
# Ejecutar el servidor standalone
cd server
npm start            # http://localhost:5000
```

Luego abre `http://localhost:5000` en el navegador o `http://localhost:5173` para desarrollo React con Vite HMR.