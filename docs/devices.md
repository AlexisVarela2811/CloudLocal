# Acompañante y Emparejamiento de Dispositivos

## ¿Qué es el Companion?

El companion es un servicio que permite compartir carpetas entre dispositivos de la red LAN. Usa un protocolo de ofertas (offers) para conectar dispositivos de forma manual, sin necesidad de servidor centralizado.

> **Nota**: el código fuente companion es legado, no se distribuye con el ejecutable y no es necesario para acceder por navegador.

## Arquitectura

```
Dispositivo A                         Dispositivo B
┌──────────────────┐                ┌──────────────────┐
│ CloudLocal.exe    │                │ CloudLocal.exe    │
│                  │                │                  │
│ ┌──────────────┐ │  WebSocket     │ ┌──────────────┐ │
│ │ Companion    │ │ ────────────► │ │ Companion    │ │
│ │ Service      │ │ (directo)     │ │ Service      │ │
│ └──────────────┘ │                │ └──────────────┘ │
└──────────────────┘                └──────────────────┘
```

La conexión es P2P (peer-to-peer): los dispositivos se conectan directamente sin intermediario, a través del mismo puerto HTTP del servidor (usualmente 80 o 5000).

## Emparejamiento de dispositivos

### Paso 1: Generar código de emparejamiento (emisor)

En el dispositivo que comparte:

1. Ve a **Configuración → Dispositivos**
2. Clic en **"Generar código"**
3. Se muestra un código como `A1B2-C3D4` válido por 5 minutos

API:
```
POST /api/devices/pair-code
{
  "name": "Mi Laptop"  // nombre del dispositivo
}
```

Respuesta:
```json
{
  "code": "A1B2-C3D4",
  "expiresAt": "2025-01-15T10:35:00Z"
}
```

### Paso 2: Vincular dispositivo (receptor)

En el dispositivo que recibe la carpeta:

1. Ve a **Configuración → Dispositivos**
2. Clic en **"Vincular dispositivo"**
3. Ingresa el código `A1B2-C3D4`
4. Selecciona la carpeta que quieres compartir
5. Clic en **"Enviar oferta"**

### Paso 3: Aceptar oferta

En el dispositivo emisor (el que compartió la carpeta):

1. Ve a **Configuración → Dispositivos**
2. Verás una **"Oferta pendiente"** del dispositivo receptor
3. Revisa la carpeta que quiere recibir
4. Clic en **"Aceptar"** o **"Rechazar"**

## Gestión de dispositivos

### Listar dispositivos vinculados

```
GET /api/devices/
```

### Listar ofertas pendientes

```
GET /api/devices/offers
```

### Enviar oferta a dispositivo

```
POST /api/devices/:id/offers
{
  "path": "/shared/folder"
}
```

### Listar entradas de carpeta compartida

```
GET /api/devices/:id/entries
?share=/shared/folder&path=
```

### Obtener contenido compartido

```
GET /api/devices/:id/content
?share=/shared/folder&path=
```

Devuelve el listado de archivos que puedes acceder remotamente.

### Desvincular dispositivo

```
DELETE /api/devices/:id
```

Elimina el vínculo y quita el acceso a las carpetas compartidas.

## Seguridad

- **LAN only**: Los dispositivos deben estar en la misma red local.
- **Sin autenticación P2P**: Una vez vinculado, el dispositivo tiene acceso total a las carpetas compartidas. No uses en redes públicas.
- **Códigos de emparejamiento**: Válidos por 5 minutos. No los compartas con desconocidos.
- **Sin cifrado**: El tráfico entre dispositivos no está cifrado. Si necesitas cifrado, usa VPN.

## Flujo de trabajo típico

1. **Preparar la carpeta**: En el servidor, crea una carpeta (ej. `C:\CloudLocal\files\shared\mis_fotos`)
2. **Generar código**: Ve a Dispositivos → Generar código
3. **Vincular**: En el otro dispositivo, ingresa el código y selecciona la misma carpeta
4. **Verificar**: Revisa las "Ofertas pendientes" y acepta
5. **Explorar**: Ve a Dispositivos → [nombre del dispositivo] → Mis fotos

Ahora puedes ver y descargar los archivos de la otra máquina.

## Límites

- **Carpeta simultánea**: Un dispositivo puede recibir varias carpetas de diferentes fuentes.
- **Archivos accesibles**: Se muestra el listado, pero los archivos se transfieren en demanda (no se descargan automáticamente).
- **Conexión**: Si el dispositivo emisor se apaga, el receptor no puede acceder a las carpetas hasta que vuelva.

## Solución de problemas

### No aparece el código

- Asegúrate de que el dispositivo emisor está en la misma red LAN.
- Verifica que el firewall permite conexiones entrantes al puerto del servidor.
- El código expira en 5 minutos.

### No se conecta el dispositivo

- Verifica que ambos dispositivos pueden pinguearse entre sí.
- Revisa que el puerto del companion (el mismo que el servidor, usualmente 80 o 5000) está abierto.
- Intenta desvincular y volver a vincular.

### Carpetas vacías

- Verifica que el path de la carpeta existe en ambos dispositivos.
- Si las carpetas están en diferentes rutas, usa el mismo path relativo.

## Ejemplo de curl

```bash
# Generar código
curl -X POST http://192.168.1.6:80/api/devices/pair-code \
  -H "Content-Type: application/json" \
  -d '{"name":"Mi Laptop"}'

# Listar dispositivos
curl http://192.168.1.6:80/api/devices/

# Ver ofertas pendientes
curl http://192.168.1.6:80/api/devices/offers
```