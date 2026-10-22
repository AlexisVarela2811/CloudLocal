# API y Autenticación

## Autenticación

CloudLocal usa autenticación básica con contraseña. Todas las rutas requieren el token `cloudlocal-auth` en los headers.

### Endpoints

| Método | Endpoint | Descripción | Body / Query |
|---|---|---|---|
| `POST` | `/api/setup` | Configurar contraseña inicial | `{ password: string }` |
| `POST` | `/api/login` | Iniciar sesión | `{ password: string }` |
| `POST` | `/api/logout` | Cerrar sesión | — |
| `GET` | `/api/session` | Estado de sesión actual | — |

### Flujo de autenticación

1. **Setup** (primera vez):
   ```bash
   curl -X POST http://localhost:80/api/setup -H "Content-Type: application/json" -d '{"password":"tuContraseña123"}'
   ```

2. **Login** (siempre después):
   ```bash
   curl -X POST http://localhost:80/api/login -H "Content-Type: application/json" -d '{"password":"tuContraseña123"}'
   ```

3. **Sesión activa**:
   ```bash
   curl http://localhost:80/api/session -H "Cookie: cloudlocal-auth=eyJhbGc..."
   ```

### Almacenamiento

La contraseña se guarda en `C:\Users\<usuario>\.cloudlocal\state\auth.json`:
```json
{
  "passwordHash": "$2b$...",
  "createdAt": "2025-01-15T10:30:00Z"
}
```

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
      "modified": "2025-01-15T10:30:00Z"
    },
    {
      "path": "/docs/fotos2025",
      "name": "fotos2025",
      "type": "directory",
      "size": 0,
      "modified": "2025-01-15T10:30:00Z"
    }
  ]
}
```

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

### Descarga de archivo

```
GET /api/files/content?path=/path/to/file
```

### Descarga ZIP

```
GET /api/files/zipDownload?paths[]=/path1&paths[]=/path2
```

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

### Eliminar a papelera

```
DELETE /api/files?path=/path/to/file
```

### Eliminación permanente

```
POST /api/files/permanentDelete
{
  "id": "/path/to/file"
}
```

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

### Eliminar permanentemente

```
DELETE /api/trash
{
  "id": "/trash/1234567890/foto.jpg"
}
```

## Estado

```
GET /api/status
```

**Respuesta**:
```json
{
  "dataDir": "C:\\Users\\alexi\\.cloudlocal\\files",
  "maxUpload": 5368709120,
  "diskUsage": 123456789,
  "diskTotal": 500000000000,
  "urls": ["http://192.168.1.6:80", "http://127.0.0.1:80"]
}
```

## Dispositivos (Companion)

### Listar vinculados

```
GET /api/devices/
```

### Generar código de emparejamiento

```
POST /api/devices/pair-code
{
  "name": "Mi Laptop"
}
```

### Enviar oferta a dispositivo

```
POST /api/devices/:id/offers
{
  "path": "/shared/folder",
  "name": "Mis fotos"
}
```

### Listar entradas compartidas

```
GET /api/devices/:id/entries
```

### Desvincular dispositivo

```
DELETE /api/devices/:id
```

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

## Variables de entorno

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `CLOUDLOCAL_PASSWORD` | (sin valor) | Contraseña fija. Si se establece, no se puede cambiar desde la UI |
| `CLOUDLOCAL_DATA_DIR` | `.cloudlocal/files` | Carpeta de archivos |
| `CLOUDLOCAL_STATE_DIR` | `.cloudlocal/state` | Carpeta de estado (auth.json) |
| `CLOUDLOCAL_PORT` | `80` | Puerto HTTP |
| `CLOUDLOCAL_HOST` | `0.0.0.0` | Interfaz a escuchar |
| `CLOUDLOCAL_MAX_UPLOAD` | `5368709120` | Límite por archivo (5 GiB) |

## Límites y errores

### Límites por defecto

- **Tamaño máximo por archivo**: 5 GiB (`5368709120` bytes)
- **Mime types bloqueados**: `.exe`, `.bat`, `.cmd`, `.scr`, `.vbs`, `.js`, `.ps1`, `.reg`

### Códigos de error

| Código | Significado |
|---|---|
| `401` | No autenticado / sesión expirada |
| `400` | Bad request (parámetros faltantes o inválidos) |
| `404` | No encontrado (archivo, carpeta, dispositivo) |
| `409` | Conflicto (archivo ya existe, contraseña incorrecta) |
| `413` | Payload demasiado grande |
| `500` | Error del servidor |

### Respuesta de error

```json
{
  "error": "Archivo ya existe",
  "path": "/docs/foto.jpg"
}
```

## Autenticación con cookie

El servidor usa cookies HTTP-only:

```
Set-Cookie: cloudlocal-auth=eyJhbGciOiJIUzI1NiJ9...; Path=/; HttpOnly; SameSite=Strict
```

Todas las peticiones deben incluir esta cookie.