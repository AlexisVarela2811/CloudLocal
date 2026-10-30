# API y Autenticación

## Autenticación

CloudLocal usa autenticación basada en cookie HttpOnly. Todas las rutas API (`/api/*`) requieren la cookie `cloudlocal_session` establecida tras el login.

### Endpoints

| Método | Endpoint | Descripción | Body / Query |
|---|---|---|---|
| `POST` | `/api/setup` | Configurar contraseña inicial | `{ password: string }` |
| `POST` | `/api/login` | Iniciar sesión | `{ password: string }` |
| `POST` | `/api/logout` | Cerrar sesión | — |
| `GET` | `/api/session` | Estado de sesión actual | — |

### Flujo de autenticación

1. **Setup** (primera vez, solo desde localhost):
   ```bash
   curl -X POST http://localhost:5000/api/setup \
     -H "Content-Type: application/json" \
     -d '{"password":"tuContraseña123"}'
   ```
   El servidor responde `201` y establece la cookie `Set-Cookie: cloudlocal_session=...; HttpOnly; SameSite=Strict; Path=/api; Max-Age=43200`.

2. **Login** (siempre después):
   ```bash
   curl -X POST http://localhost:5000/api/login \
     -H "Content-Type: application/json" \
     -d '{"password":"tuContraseña123"}' \
     -b "cloudlocal_session=<token>"
   ```

3. **Sesión activa**: incluir la cookie en cada petición:
   ```bash
   curl http://localhost:5000/api/files \
     -b "cloudlocal_session=abcdef123456..."
   ```

### Almacenamiento

La contraseña se almacena con hash scrypt en `C:\Users\<usuario>\.cloudlocal\state\auth.json`:
```json
{
  "version": 1,
  "salt": "<base64, 32 bytes>",
  "hash": "<base64, 64 bytes>",
  "createdAt": "2025-01-15T10:30:00Z"
}
```

> La contraseña debe tener entre 12 y 256 caracteres. El hash usa scrypt con salt de 32 bytes y un hash de 64 bytes.

### Seguridad de la cookie

| Atributo | Valor |
|---|---|
| Nombre | `cloudlocal_session` |
| HttpOnly | Sí (no accesible desde JavaScript) |
| SameSite | `Strict` |
| Path | `/api` |
| Max-Age | 43200 s (12 h) |

---

## Archivos

### Listado

```
GET /api/files?folder=/path/to/dir&q=search
```

**Respuesta**:
```json
{
  "entries": [
    {
      "path": "/docs/foto.jpg",
      "name": "foto.jpg",
      "type": "file",
      "size": 12345,
      "modifiedAt": "2025-01-15T10:30:00Z"
    },
    {
      "path": "/docs/fotos2025",
      "name": "fotos2025",
      "type": "directory",
      "size": 0,
      "children": 42,
      "modifiedAt": "2025-01-15T10:30:00Z"
    }
  ]
}
```

Las carpetas incluyen `children`, el número de elementos que contienen. Los archivos no llevan ese campo.

### Crear carpeta

```
POST /api/folders
{
  "folder": "/path/to/parent",
  "name": "Nueva carpeta"
}
```

### Subida de archivos

```
POST /api/files/upload?folder=/path/to/dir
```

- Multipart/form-data, campo `file`
- Límite por archivo: 512 MiB (configurable vía `CLOUDLOCAL_MAX_UPLOAD`)
- Extensiones prohibidas: `.exe`, `.bat`, `.cmd`, `.scr`, `.vbs`, `.js`, `.ps1`, `.reg`

### Descarga de archivo

```
GET /api/files/content?path=/path/to/file
```

Añade `?inline=1` para que el navegador lo muestre en lugar de descargarlo.

### Descarga ZIP

```
GET /api/files/zip?paths[]=/path1&paths[]=/path2
```

### Vista previa de imagen

```
GET /api/files/preview/fotos/playa.jpg
```

El `*` de la ruta es la ruta relativa de la imagen. Responde `400` si el tipo no es una imagen y sirve el archivo con `Cache-Control: public, max-age=3600`.

### Copiar archivo/carpeta

```
POST /api/files/copy
{
  "from": "/path/to/source",
  "to": "/path/to/dest"
}
```

### Mover archivo/carpeta

```
POST /api/files/move
{
  "from": "/path/to/source",
  "to": "/path/to/dest"
}

POST /api/files/moveFolder
{
  "from": "/path/to/source",
  "to": "/path/to/dest"
}
```

Para mover a una carpeta existente sin interpretar el destino como un nuevo nombre, añade `"mode": "into"` al cuerpo de cualquiera de las dos solicitudes. `to: ""` indica Inicio. Si la carpeta de destino no existe, la operación falla sin renombrar el origen. Sin `mode`, `/api/files/move` conserva su comportamiento anterior de movimiento o cambio de nombre.

### Pegar del portapapeles interno

```
POST /api/files/paste
{
  "from": "/path/to/source",
  "to": "/path/to/dest",
  "type": "file"
}
```

`type` es `file` o `folder` (obligatorio; cualquier otro valor responde `400`). Copia el elemento a `to` y emite el evento SSE `paste`.

### Eliminar a papelera

```
DELETE /api/files?path=/path/to/file
```

### Eliminación permanente

```
POST /api/files/permanent
{
  "id": "<trash-id>"
}
```

El `id` es el de la entrada en la papelera que devuelve `GET /api/trash`.

---

## Papelera

### Listar

```
GET /api/trash
```

### Restaurar

```
POST /api/trash/:id/restore
```

### Vaciar papelera

```
POST /api/trash/empty
```

---

## Shutdown

`POST /api/shutdown` requiere una sesión válida, `Content-Type: application/json` y body `{}`.

- `200`: `{ "message": "Server shutting down..." }`. Primero se envía la respuesta; después se cierra el servidor HTTP y termina únicamente el proceso de esa instancia.
- `401`: `{ "message": "Authentication required" }`
- `403`: `{ "message": "Local origin required" }`
- `415`: `{ "message": "JSON required" }`
- `503`: `{ "message": "Shutdown unavailable" }` (sin ciclo de vida HTTP conectado)

El cierre dispone de hasta tres segundos para drenar conexiones antes de terminar el proceso.

---

## Estado

```
GET /api/status
```

**Respuesta**:
```json
{
  "storage": {
    "total": 500000000000,
    "free": 376543210000
  },
  "maxUploadBytes": 536870912,
  "urls": ["http://192.168.1.6:5000", "http://127.0.0.1:5000"]
}
```

---

## Eventos en vivo (SSE)

```
GET /api/events
```

Stream `text/event-stream` con los cambios del sistema de archivos. Usa la
misma cookie de sesión que el resto de `/api`. El cliente abre una conexión al
entrar y refresca el listado al recibir un evento. Los eventos emitidos por el
servidor son:

| Evento | Cuándo |
|---|---|
| `upload` | Se sube un archivo |
| `folder` | Se crea una carpeta |
| `paste` | Se pega desde el portapapeles interno |
| `move` | Se mueve o renombra |
| `copy` | Se copia |
| `trash` | Se envía a la papelera |
| `restore` | Se restaura desde la papelera |

Al detener el servidor la conexión se cierra.

---

## Rutas legacy (compatibilidad)

Se mantienen por compatibilidad con clientes antiguos y solo operan sobre la raíz del almacenamiento (no aceptan subcarpetas):

```
GET    /api/files/list
GET    /api/files/download/:filename
DELETE /api/files/delete/:filename
```

- `list` devuelve solo los nombres de los archivos de la raíz.
- `download` y `delete` reciben un nombre de archivo, no una ruta. `delete` compara sin distinguir mayúsculas y responde `409` si el nombre es ambiguo, `404` si no existe.

---

## Configuración

### Obtener configuración

```
GET /api/settings
```

### Guardar carpeta de datos

```
PUT /api/settings
{
  "folderPath": "C:\\Nuevo\\path\\files"
}
```

### Restablecer carpeta por defecto

```
DELETE /api/settings
```

---

## Variables de entorno

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `HOST` | `0.0.0.0` | Interfaz a escuchar (no `CLOUDLOCAL_HOST`) |
| `CLOUDLOCAL_PORT` | `5000` | Puerto HTTP principal |
| `PORT` | `5000` | Alternativa (solo server standalone) |
| `CLOUDLOCAL_FALLBACK_PORT` | `5000` | Puerto de respaldo |
| `CLOUDLOCAL_DATA_DIR` | `.cloudlocal/files` | Carpeta de archivos |
| `CLOUDLOCAL_STATE_DIR` | `.cloudlocal/state` | Carpeta de estado (auth.json) |
| `CLOUDLOCAL_MAX_UPLOAD` | `536870912` | Límite por archivo (512 MiB) |
| `CLOUDLOCAL_ENV_FILE` | `.env` (raíz del server) | Archivo de variables de entorno |

> El launcher fija `CLOUDLOCAL_PORT=80` automáticamente al iniciar.

---

## Límites y errores

### Límites por defecto

- **Tamaño máximo por archivo**: 512 MiB (`536870912` bytes)
- **Mime types bloqueados**: `.exe`, `.bat`, `.cmd`, `.scr`, `.vbs`, `.js`, `.ps1`, `.reg`
- **Sesiones máximas**: 1024
- **Intentos fallidos**: bloqueo tras 5 intentos consecutivos (ventana de 15 min)
- **Longitud de contraseña**: 12–256 caracteres

### Códigos de error

| Código | Significado |
|---|---|
| `400` | Bad request (parámetros faltantes o inválidos) |
| `401` | No autenticado / sesión expirada |
| `403` | Origen externo no permitido |
| `404` | No encontrado (archivo o carpeta) |
| `409` | Conflicto (archivo ya existe, contraseña incorrecta) |
| `413` | Payload demasiado grande |
| `415` | Tipo de contenido no soportado |
| `429` | Demasiadas solicitudes (subidas o intentos) |
| `500` | Error del servidor |

### Respuesta de error

```json
{
  "message": "Archivo ya existe"
}
```