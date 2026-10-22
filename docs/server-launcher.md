# Servidor Portable y Configuración

## CloudLocal.exe — Cómo funciona

CloudLocal.exe es un ejecutable autocontenido que incluye:

1. **El servidor Node.js** (HTTP API + frontend estático)
2. **El cliente web** (React, TypeScript, Vite build)
3. **El companion service** (relay P2P para dispositivos LAN)

## Instalación

### Windows

1. Descarga `launcher/dist/CloudLocal.exe`
2. Haz doble clic para ejecutarlo
3. La primera vez Windows puede bloquearlo — clic en **"Más información" → "Ejecutar de todos modos"**
4. Se abre una consola negra. **No la cierres** mientras quieras usar el servidor

### Configuración inicial

La primera vez que ejecutas CloudLocal:

1. Abre `http://localhost:80` (o el puerto configurado)
2. Verás la pantalla de **Acceso** con campo de contraseña
3. Configura una contraseña de al menos 12 caracteres
4. Guarda la contraseña en un gestor seguro (es la única forma de entrar después)

## Puertos

Por defecto, CloudLocal escucha en el puerto **80** (HTTP). Puedes cambiarlo con:

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `CLOUDLOCAL_PORT` | `80` | Puerto HTTP del servidor |
| `CLOUDLOCAL_HOST` | `0.0.0.0` | Interfaz a escuchar (`0.0.0.0` = todas, `127.0.0.1` = solo localhost) |

## Carpeta de almacenamiento

Los archivos se almacenan en `.cloudlocal/files/` dentro del directorio de usuario (normalmente `C:\Users\<usuario>\.cloudlocal\files\`).

Puedes cambiar la carpeta desde la UI en **Configuración → Cambiar carpeta**.

### Variables de entorno de almacenamiento

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `CLOUDLOCAL_DATA_DIR` | `.cloudlocal/files` | Carpeta donde se almacenan los archivos |
| `CLOUDLOCAL_STATE_DIR` | `.cloudlocal/state` | Carpeta de estado y credenciales (auth.json) |

## Seguridad

- **Contraseña**: se guarda en `C:\Users\<usuario>\.cloudlocal\state\auth.json`
- **Encriptación**: la contraseña se almacena con hash (bcrypt)
- **HTTP vs HTTPS**: CloudLocal no soporta HTTPS nativo. Si necesitas cifrado, usa un proxy inverso (nginx, Caddy) delante del puerto 80.
- **Acceso LAN**: cualquier dispositivo en la misma red puede acceder a `http://<IP-SERVIDOR>:80`. Configura un firewall si solo quieres acceso local.

## Solución de problemas

### No se puede ejecutar CloudLocal.exe

- Windows Defender puede bloquearlo. Agrega la carpeta a las exclusiones.
- Asegúrate de tener Node.js 22+ instalado (el launcher lo incluye embebido).

### No arranca el servidor

- Verifica que el puerto 80 no lo esté usando otro programa (IIS, Skype, VPN).
- Cambia `CLOUDLOCAL_PORT` a otro valor (ej. 8080).

### Los archivos no aparecen

- Verifica que la carpeta `.cloudlocal/files/` existe y tiene permisos de escritura.
- Reinicia el servidor después de cambiar la carpeta desde la UI.

## Ejecución desde código fuente

```sh
# Compilar el cliente
cd client
npm run build

# Ejecutar el launcher (dev)
cd launcher
node scripts/build.cjs  # Empaqueta en CloudLocal.exe
```

Luego ejecuta `launcher/dist/CloudLocal.exe` como de costumbre.