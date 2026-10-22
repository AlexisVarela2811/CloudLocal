# CloudLocal — Private Local File Server

**Un ejecutable pone en marcha tu nube local; los demás equipos entran desde el navegador.** Los archivos quedan en el ordenador servidor, que debe permanecer encendido y despierto. No se necesitan clientes, códigos de vinculación ni otra aplicación en Ubuntu, móviles u otros ordenadores para subir, consultar y descargar archivos.

![CloudLocal](diagrama.svg)

---

## Descripción

CloudLocal es un servidor de archivos local privado que se ejecuta como un único ejecutable portátil. Ofrece una interfaz web completa con:

### Interfaz de usuario

- **Sidebar** con navegación por secciones (Archivos, Papelera, Configuración)
- **Navegación de carpetas** con breadcrumbs y botón de retroceso
- **Tabla de archivos** con columnas de nombre, detalles y acciones
- **Vista en cuadrícula** y vista en lista (alternable)
- **Selección múltiple** con clic o Ctrl+A
- **Barra de selección** inferior con acciones rápidas
- **Búsqueda** en la carpeta actual

### Operaciones de archivos

- **Drag & Drop externo**: sube archivos arrastrándolos desde el explorador del sistema
- **Drag & Drop interno**: mueve archivos y carpetas arrastrándolos sobre carpetas destino
- **Copiar / Cortar / Pegar**: Ctrl+C, Ctrl+X, Ctrl+V para duplicar o mover entre carpetas
- **Renombrado inline**: F2 para renombrar archivos y carpetas directamente
- **Nueva carpeta**: botón en toolbar o Ctrl+N para crear carpetas
- **Vista previa** de imágenes, vídeo y audio en modal con cierre por Escape o click exterior
- **Papelera** con restauración, eliminación permanente y vaciado total
- **Descarga ZIP**: comprime múltiples archivos en un solo ZIP para descargar

### Apariencia y accesibilidad

- **Modo oscuro**: toggle grande y visible, persistencia en localStorage, detección automática del tema del sistema, sincronización instantánea entre pestañas
- **Indicadores de foco**: `:focus-visible` visible en todos los controles interactivos (3px solid accent, offset 2px)
- **Atajos de teclado**: Ctrl+A (seleccionar todo), Ctrl+C (copiar), Ctrl+X (cortar), Ctrl+V (pegar), Ctrl+N (nueva carpeta), Ctrl+S (volver atrás), F2 (renombrar), Delete (a papelera), Escape (cerrar modal/renaming)
- **Diseño responsive**: adaptado para escritorio, tablet y móvil
- **Accesibilidad**: skip-link, roles ARIA, navegación completa por teclado

### Integración de red

- **Gestión de dispositivos**: compartir carpetas entre equipos de la LAN vía companion service

---

## Instalación

### Windows (ejecutable portátil)

1. Descarga `launcher/dist/CloudLocal.exe`
2. Ejecuta el archivo y deja abierta su consola
3. Abre `http://localhost:80` (o el puerto configurado) en el navegador
4. Configura una contraseña de al menos 12 caracteres en la pantalla de acceso inicial
5. Desde otros equipos de la red, abre `http://<IP-SERVIDOR>:80` e inicia sesión

### Desarrollo (desde el código fuente)

#### Requisitos

- [Node.js](https://nodejs.org/) 22.12 o posterior con npm
- Un editor con soporte TypeScript y React (VS Code recomendado)

#### Servidor

```sh
cd server
npm ci --workspaces=false
```

#### Cliente web

```sh
cd client
npm ci --workspaces=false
```

#### Compilar y construir

```sh
cd client
npm run build        # Compila TypeScript y genera el bundle estático
```

#### Lanzar servidor + cliente embebido

```sh
cd server
npm start            # Sirve API + frontend embebido en http://localhost:80
```

#### Desarrollo independiente de React

```sh
cd client
npm run dev          # Inicia Vite en http://localhost:5173 con HMR
```

### Otros componentes

| Componente | Descripción |
|---|---|
| `server/` | API REST (Node.js) que gestiona el sistema de archivos |
| `client/` | Interfaz web React con TypeScript + TailwindCSS |
| `companion/` | Servicio auxiliar para conexión entre dispositivos |
| `launcher/` | Empaquetado portátil (Node.js SEA) — produce `CloudLocal.exe` |

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                        Red LAN                          │
│                                                         │
│  ┌──────────┐    HTTP     ┌──────────────────┐         │
│  │  Navegador│ ──────────► │   server/        │         │
│  │  (client/)│             │   (API + static) │         │
│  └──────────┘             │                  │         │
│  ┌──────────┐             │  ┌────────────┐  │         │
│  │  Móvil   │ ──────────► │  │ .cloudlocal│  │         │
│  └──────────┘             │  │ /state     │  │         │
│                           │  └────────────┘  │         │
│                           │  ┌────────────┐  │         │
│                           │  │ .cloudlocal│  │         │
│                           │  │ /files     │  │         │
│                           │  └────────────┘  │         │
│                           └──────────────────┘         │
│                                                         │
│  ┌──────────┐    WebSocket│   companion/                │
│  │  PC Remoto│ ──────────► │  (relay entre equipos)    │
│  └──────────┘             └───────────────────────────┘
```

### Server (`server/`)

API REST con autenticación basada en contraseña. Gestiona:

- Listado y navegación de carpetas
- Subida de archivos con barra de progreso
- Descarga y vistas previas
- Papelera (borrado temporal y permanente)
- Configuración de carpeta de datos

### Client (`client/`)

Aplicación React con TypeScript organizada en:

- `App.tsx` — Orquestación principal (auth, routing, estado, shortcuts de teclado)
- `components/Access.tsx` — Pantalla de autenticación (acceso con contraseña)
- `components/Preview.tsx` — Modal de vista previa (imágenes, vídeo, audio, PDF)
- `components/Settings.tsx` — Configuración y toggle de modo oscuro (toggle grande, 64px ancho)
- `components/DragAndDrop.tsx` — Overlay de arrastrar y soltar (subida externa)
- `components/UploadQueue.tsx` — Cola de subida con progreso y retry/cancel
- `components/Devices.tsx` — Gestión de dispositivos emparejados
- `hooks/useDragUpload.ts` — Hook para arrastrar archivos externos
- `api/api.ts` — Cliente HTTP Axios (todos los endpoints)
- `workspace.mjs` — Utilidades (formateo, breadcrumb, tipado de preview)

### Companion (`companion/`)

Servicio que facilita la comunicación P2P entre dispositivos mediante un protocolo de ofertas.

### Launcher (`launcher/`)

Empaquetador que combina servidor + frontend en un ejecutable portátil usando Node.js Secure Node (SEA).

---

## API — Endpoints

### Autenticación

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/setup` | Configurar contraseña inicial |
| `POST` | `/api/login` | Iniciar sesión con contraseña |
| `POST` | `/api/logout` | Cerrar sesión |

### Archivos

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/files` | Listar archivos (`?folder=&q=`) |
| `POST` | `/api/folders` | Crear carpeta (`{folder, name}`) |
| `POST` | `/api/files/upload` | Subir archivo multipart (`?folder=`) |
| `DELETE` | `/api/files` | Enviar a papelera (`?path=`) |
| `POST` | `/api/files/copy` | Copiar archivo/folder (`{from, to}`) |
| `POST` | `/api/files/move` | Mover archivo (`{from, to}`) |
| `POST` | `/api/files/moveFolder` | Mover carpeta (`{from, to}`) |
| `POST` | `/api/files/permanentDelete` | Eliminación permanente (`{id}`) |
| `GET` | `/api/files/zipDownload` | Descargar como ZIP (`?paths[]=`) |
| `GET` | `/api/files/content` | Obtener contenido (`?path=`) |

### Papelera

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/trash` | Listar archivos en papelera |
| `POST` | `/api/trash/:id/restore` | Restaurar archivo |
| `POST` | `/api/trash/empty` | Vaciar papelera (todos) |
| `DELETE` | `/api/trash` | Borrar archivo permanentemente |

### Estado

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/status` | Espacio en disco, límite de subida, URLs |
| `GET` | `/api/session` | Estado de sesión actual |

### Dispositivos

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/devices/` | Listar dispositivos vinculados |
| `GET` | `/api/devices/offers` | Listar ofertas pendientes |
| `POST` | `/api/devices/pair-code` | Generar código de emparejamiento |
| `POST` | `/api/devices/:id/offers` | Enviar oferta a dispositivo |
| `GET` | `/api/devices/:id/entries` | Listar entradas compartidas |
| `GET` | `/api/devices/:id/content` | Obtener contenido compartido |
| `DELETE` | `/api/devices/:id` | Desvincular dispositivo |

### Configuración

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/settings` | Obtener configuración |
| `PUT` | `/api/settings` | Guardar carpeta (`{folderPath}`) |
| `DELETE` | `/api/settings` | Restablecer carpeta por defecto |

---

## Variables de entorno

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `CLOUDLOCAL_PASSWORD` | Contraseña para acceso inicial. Si se establece, no se puede cambiar desde la UI. | Se solicita en el asistente |
| `CLOUDLOCAL_DATA_DIR` | Ruta de la carpeta donde se almacenan los archivos. | `.cloudlocal/files` |
| `CLOUDLOCAL_STATE_DIR` | Ruta del directorio de estado y credenciales. | `.cloudlocal/state` |
| `CLOUDLOCAL_PORT` | Puerto HTTP del servidor. | `5000` |
| `CLOUDLOCAL_HOST` | Interfaz de red a escuchar. | `0.0.0.0` |
| `CLOUDLOCAL_MAX_UPLOAD` | Tamaño máximo de archivo en bytes. | `5368709120` (5 GiB) |

---

## Funcionalidades destacadas

### Sidebar

Panel lateral fijo con navegación rápida a Archivos, Papelera y Configuración. Incluye indicador de estado del servidor (en línea/desconectado) y botón para cerrar sesión. En móvil se muestra como panel deslizable.

### Navegación de carpetas

- **Breadcrumbs**: ruta actual clickeable (`/ > documentos > fotos > 2025`)
- **Botón de retroceso**: flecha izquierda para volver a la carpeta padre
- **Doble clic en carpetas**: navega directamente dentro

### Tabla de archivos

Vista tabular con columnas de nombre, tamaño/modificación y acciones (vista previa, descarga, eliminar). Las carpetas son navegables con clic; los archivos muestran acciones contextuales. Soporta vista en lista y vista en cuadrícula (alternable con botón en toolbar).

### Drag & Drop externo

Arrastra archivos desde el explorador del sistema directamente a la ventana para subirlos. Se muestra un overlay con confirmación visual. La barra de progreso aparece en la esquina inferior derecha.

### Drag & Drop interno

Arrastra un archivo o carpeta sobre otra carpeta para moverlo directamente. La carpeta destino se resalta para indicar que es un punto de drop válido.

### Copiar, cortar y pegar

Selección múltiple con clic o Ctrl+A. Copiar (Ctrl+C) y cortar (Ctrl+X) al portapapeles interno. Pegar (Ctrl+V) en la carpeta actual. Las operaciones se procesan en serie.

### Renombrado inline

Selecciona un archivo y pulsa F2. El nombre se convierte en un campo editable. Pulsa Enter para confirmar o Escape para cancelar. La validación incluye:
- No permitir nombres vacíos
- No permitir duplicados en la carpeta
- No permitir nombres de sistema (`CON`, `PRN`, `NUL`, etc.)

### Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+A` | Seleccionar todo |
| `Ctrl+C` | Copiar al portapapeles |
| `Ctrl+X` | Cortar (mover) al portapapeles |
| `Ctrl+V` | Pegar en carpeta actual |
| `Ctrl+N` | Nueva carpeta |
| `Ctrl+S` | Volver a la carpeta padre |
| `F2` | Renombrar elemento seleccionado |
| `Delete` | Enviar a papelera |
| `Escape` | Cerrar modal, cancelar renaming |
| `Tab` | Navegación entre controles (focus visible) |

### Vista previa

- **Imágenes**: se muestra en un modal con fondo oscuro. Cierre con Escape o clic fuera. La imagen se escala al viewport.
- **Vídeo**: reproductor HTML5 integrado.
- **Audio**: reproductor de audio HTML5.
- **PDF**: se abre en una nueva pestaña del navegador.

### Papelera

- **Mover a papelera**: Delete (seleccionados) o botón eliminar
- **Restaurar**: restaura al path original
- **Eliminar permanentemente**: elimina el archivo del almacenamiento
- **Vaciar papelera**: elimina todos los elementos de forma masiva

### Descarga ZIP

Selecciona múltiples archivos y pulsa el botón de descarga ZIP. Los archivos se compriman en el servidor y se descargan como un único archivo `.zip`.

### Modo oscuro

Actívalo en la sección Configuración mediante un toggle grande (64×34px) con track y thumb. Se guarda en `localStorage` (`cloudlocal-theme: "dark"` / `"light"`), se detecta automáticamente si el sistema operativo usa tema oscuro, y se sincroniza instantáneamente entre todas las pestañas abiertas vía `storage` event. Las variables CSS se aplican mediante `data-theme` en el `<html>`.
### Diseño responsive

| Breakpoint | Comportamiento |
|---|---|
| `> 1024px` | Sidebar fijo, tabla completa |
| `768px – 1024px` | Sidebar fijo, espacio reducido |
| `481px – 768px` | Sidebar deslizable, columna de detalles oculta |
| `≤ 480px` | Sidebar deslizable, acciones compactadas |

---

## Contribución

### Guía para desarrolladores

#### Estructura del proyecto

```
CloudLocal/
├── server/           # API REST (Node.js)
│   ├── src/          # server.js, storage.js, router, controller
│   └── test/         # Muestras de tests unitarios
├── client/           # Frontend React (TypeScript + Vite)
│   ├── src/
│   │   ├── api/      # Cliente HTTP Axios (api.ts)
│   │   ├── components/
│   │   │   ├── Access.tsx        # Pantalla de acceso
│   │   │   ├── DragAndDrop.tsx   # Overlay de drag & drop
│   │   │   ├── Preview.tsx       # Modal de vista previa
│   │   │   ├── Settings.tsx      # Configuración y toggle dark mode
│   │   │   ├── UploadQueue.tsx   # Cola de subida con progreso
│   │   │   └── Devices.tsx       # Gestión de dispositivos LAN
│   │   ├── hooks/
│   │   │   └── useDragUpload.ts  # Hook de drag & drop
│   │   ├── App.tsx         # Orquestación principal
│   │   └── index.css       # Estilos globales (variables, focus, themes)
│   └── public/
├── companion/        # Servicio P2P
├── launcher/         # Empaquetado portátil (Node.js SEA)
└── odd/              # Especificaciones y tareas (ODD)
```

#### Flujo de trabajo

1. Clona el repositorio y abre la carpeta raíz
2. Instala dependencias por componente (`npm ci --workspaces=false` dentro de cada carpeta)
3. Compila `client` con `npm run build`
4. Ejecuta `server` con `npm start`
5. Para desarrollo React en caliente: `npm run dev` en `client/`
6. Abre `http://localhost:5173` (Vite dev) o `http://localhost:80` (server embebido)

#### convenciones

- **TypeScript**: strict mode habilitado. No uses `any` salvo necesidad documentada.
- **Componentes React**: funcionales con hooks. Nombres `PascalCase`.
- **CSS**: TailwindCSS como base, variables CSS personalizadas para theming. Sin modificar `index.css` salvo indicación.
- **Comentarios**: en español. JSDoc para funciones exportadas.
- **Tests**: unitarios en `test/` por componente. E2E con `run-browser-smoke.cjs`.
- **Commits**: estilo [Conventional Commits](https://www.conventionalcommits.org/).

#### Validación antes de push

```sh
# Compilar cliente
npm --prefix client run build

# Lint
npm --prefix client run lint

# Ejecutar todos los tests
node --test server/test/*.test.js companion/test/*.test.cjs
node --test desktop/test/*.test.cjs
node --test client/test/*.test.mjs
```

#### Crear un cambio

1. Crea una rama descriptiva: `feat/nueva-funcion` o `fix/problema-descriptivo`
2. Implementa y verifica con los tests
3. Commit con mensaje convencional: `feat(client): add dark mode toggle`
4. Push y abre Pull Request

---

## Licencia

MIT License

Copyright (c) 2025 CloudLocal

Se concede permiso, sin cargo, a cualquier persona que obtenga una copia
de este software y los archivos de documentación asociados (el "Software"),
para usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar
y/o vender copias del Software, y permitir a las personas a whom se le
proporcione hacerlo, sujeto a las siguientes condiciones:

El aviso de copyright anterior y este aviso de permiso se incluirán en todas
las copias o partes sustanciales del Software.

EL SOFTWARE SE PROPORCIONA "TAL CUAL", SIN GARANTÍA DE NINGÚN TIPO, EXPRESA
O IMPLÍCITA, INCLUDING PERO NO LIMITADO A GARANTÍAS DE COMERCIALIZACIÓN,
IDONEIDAD PARA UN PROPÓSITO PARTICULAR E INFRACCIÓN. NINGÚN AUTOR O
PROPIETARIO DE LOS DERECHOS DE AUTOR SERÁ RESPONSABLE DE NINGUNA RECLAMACIÓN,
DAÑOS U OTRA RESPONSABILIDAD, YA SEA EN UNA ACCIÓN DE CONTRATO, AGRAVIO O
DE OTRO MODO, ARISING OUT OF, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## Documentación adicional

- [Servidor portable y configuración](docs/server-launcher.md)
- [API y autenticación](docs/api.md)
- [Acompañante y emparejamiento de dispositivos](docs/devices.md)

## Licencia