# CloudLocal 0.1.0 — candidato local

Candidato `0.1.0-rc.1` para Windows x64. Segunda iteración del shell de la interfaz (Híbrido Studio) y del backend de archivos: papelera real, diálogo de mover con destinos existentes, miniaturas por tipo de archivo y refresco en vivo por SSE. No constituye un release publicado.

## Novedades desde 0.0.1

### Interfaz

- **Shell Híbrido Studio**: rail de iconos de 64 px con tooltips y punto de servidor, topbar con migas de pan, galería y tabla con columnas divididas; tema claro cálido y tema oscuro conmutable y sincronizado entre el rail y Configuración.
- **Selección múltiple**: con dos o más elementos seleccionados, el inspector resume el conteo, los tamaños y la lista, y ofrece descargar (archivos) y mover; un solo elemento conserva el panel de detalle.
- **Miniaturas e iconos por extensión**: imágenes y videos muestran miniatura real con carga concurrente acotada y cancelación; el resto de archivos usa iconos por tipo, sin renderizar páginas de documentos.
- **Papelera**: eliminar archivos y carpetas con su contenido, restaurar, eliminar definitivamente y vaciar la papelera desde la interfaz.
- **Diálogo de mover real**: explora carpetas existentes como destino; los destinos inexistentes ya no se interpretan como renombrado. Mover a Inicio usa destino vacío.
- **Refresco en vivo por SSE**: los cambios del árbol de archivos se reflejan sin recargar.
- **Configuración reconstruida** con las secciones híbridas, a ancho completo del espacio de trabajo.
- **Tipografía Inter autoalojada**: sin dependencia de Internet en la LAN; sigue fuentes del sistema como respaldo.
- **Avatar decorativo local**: generado en el navegador con semilla persistente en `localStorage`, dibujado como SVG inline compatible con la CSP de producción.
- Vista de recientes como tarjetas horizontales compactas, filtros por tipo, barra de subida compacta y avisos de alcance del servidor en el inicio de sesión.

### Backend

- Endpoints de papelera (`/api/trash`, restaurar, vaciar) y carpetas; `move` y `moveFolder` con modo destino explícito que rechaza destinos inexistentes (los clientes legados conservan el contrato de renombrado).
- Retirados los hooks de apagado del Device Hub obsoleto que provocaban un fallo en el apagado del servidor.

### Empaquetado

- El README incluido en el candidato usa la versión del producto en lugar de una cadena fija.

## Para usar el candidato

1. Extrae todos los archivos del ZIP y ejecuta `CloudLocal.exe`. No necesitas instalar Node.js ni Bun.
2. Configura la contraseña desde `http://localhost:80` en el equipo servidor. El launcher intenta el puerto 5000 si el preferido no está disponible; usa la dirección y el puerto reales del inicio.
3. En otros equipos de la LAN, abre la IP del servidor con ese puerto e inicia sesión.
4. Espera a que finalicen las transferencias antes de pulsar **Detener Server**. Solo se cierra esa instancia. Para reiniciar, ejecuta el archivo otra vez y recarga la página.

El equipo servidor debe permanecer encendido. HTTP no cifra el tráfico: úsalo únicamente en una red de confianza y no expongas el puerto a Internet. Conserva copias de seguridad de tus archivos.

## Construir desde el código fuente

Requisitos del equipo de construcción: Windows x64, Node.js 22.12+ con npm, Git y el `tar.exe` incluido en Windows 10/11. El runtime incluido se fija a Node.js 22.23.2 en `launcher/package.json`.

Desde la raíz del repositorio:

```sh
# Dependencias bloqueadas: client/server y después launcher
npm ci
cd launcher
npm ci
cd ..

# Navegador para los tests de Playwright
npx playwright install chromium

# TypeScript + Vite, seguido de tests del servidor, navegador y launcher
npm run build:frontend
npm test

# Ejecutable real y prueba aislada del botón de cierre
npm run build:exe
npm run smoke:exe

# Generar y verificar el candidato local
npm run release:candidate -- 0.1.0-rc.1
npm run release:verify -- launcher/dist/release/0.1.0-rc.1-windows-x64
```

Los tests de navegador requieren Chromium; no se omiten automáticamente si falta. La receta debe ejecutarse y registrarse para el candidato; documentarla no demuestra por sí sola una instalación en un Windows limpio.

El creador rechaza un candidato o archivo de salida que ya exista, sin sobrescribirlo. Para un candidato posterior, usa otro identificador explícito, por ejemplo `npm run release:candidate -- 0.1.0-rc.2`. No cambies ni muevas un tag para repetir el empaquetado.

## Archivos de distribución

| Ruta bajo `launcher/dist/release/` | Contenido |
|---|---|
| `0.1.0-rc.1-windows-x64.zip` | Paquete portátil con el payload completo |
| `0.1.0-rc.1-windows-x64.zip.sha256` | Checksum externo del ZIP final |
| `0.1.0-rc.1-windows-x64/` | El mismo payload sin comprimir |

El payload contiene exactamente:

- `CloudLocal.exe`: servidor y cliente web en un Node.js SEA (*single-executable application*), sin consola.
- `README.md`: instrucciones de usuario autocontenidas, sin depender de archivos del repositorio.
- `RELEASE-NOTES.md`: alcance, procedencia y advertencias del candidato.
- `LICENSE`: licencia MIT de CloudLocal, según la declaración existente del proyecto.
- `NODE-LICENSE.txt`: licencia upstream de Node.js 22.23.2 y sus componentes incluidos.
- `THIRD-PARTY-NOTICES.txt`: versiones, licencias declaradas y textos LICENSE/NOTICE disponibles de las dependencias de producción instaladas de cliente y servidor.
- `candidate.json`: versión del producto y candidato, plataforma, hash del ejecutable, estado Git y huella del código runtime.
- `SHA256SUMS`: checksum de cada archivo anterior, incluido `candidate.json`, excluyéndose a sí mismo.

No se distribuyen credenciales, archivos del usuario, `.env`, cachés, `node_modules`, `server.cjs`, `sea.json` ni `sea.blob`. Estos últimos son intermediarios del build, no entregables.

## Verificar integridad

En Windows, calcula el SHA-256 del ZIP:

```bat
certutil -hashfile launcher\dist\release\0.1.0-rc.1-windows-x64.zip SHA256
```

Compáralo con `0.1.0-rc.1-windows-x64.zip.sha256`. El archivo de checksum es un hermano del ZIP: no se incluye dentro del ZIP que identifica.

Tras extraer el contenido, ejecuta el verificador desde un checkout del proyecto:

```sh
npm run release:verify -- launcher/dist/release/0.1.0-rc.1-windows-x64
```

El verificador exige el conjunto exacto de archivos y las entradas completas de `SHA256SUMS`; rechaza alteraciones, enlaces simbólicos y rutas inseguras. Para comprobar un archivo manualmente, usa `certutil -hashfile CloudLocal.exe SHA256` y compara con `SHA256SUMS`.

**Un checksum comprueba integridad, no autentica al editor.** Si un tercero reemplaza tanto el archivo como su checksum, esta comprobación no demuestra procedencia confiable.

## Firma y procedencia

No se realizó firma confiable de CloudLocal ni se verificó Authenticode en este entorno. El binario Node upstream puede conservar una firma que la inyección SEA invalide. [La documentación oficial de Node.js](https://nodejs.org/api/single-executable-applications.html#injecting-the-preparation-blob-manually) indica que retirar la firma de Windows antes de inyectar es opcional; si no se retira, puede aparecer una advertencia de firma de postject.

No interpretes esa advertencia, ni su ausencia, como validación de firma. Windows puede mostrar advertencias de seguridad; no hace falta desactivar el antivirus ni agregar exclusiones para preparar el candidato.

`candidate.json` distingue el commit y el estado Git al empaquetar. Una huella del código runtime identifica el estado aceptado; el SHA-256 del ejecutable identifica los bytes distribuidos. Un checkout modificado no debe presentarse como un build limpio de un tag.

La licencia Node incluida proviene de `https://raw.githubusercontent.com/nodejs/node/v22.23.2/LICENSE`, conservada sin cambios en `launcher/resources/NODE-LICENSE-22.23.2.txt`. Los avisos de terceros se generan a partir de las dependencias instaladas; no son una afirmación de auditoría legal exhaustiva.

## Alcance de esta versión

- El diálogo de mover solo propone carpetas existentes; no crea destinos nuevos ni renombra. Los clientes legados conservan el contrato previo de renombrado.
- Las carpetas no reportan tamaño acumulado; el inspector de selección múltiple muestra conteo y elementos, y la descarga múltiple incluye solo archivos.
- Las miniaturas cubren imágenes y videos; el resto de tipos usa iconos por extensión, sin renderizar documentos.
- No se incluye icono de bandeja, mDNS ni actualizaciones automáticas. La ayuda de inicio abre el navegador y puede mostrar una notificación.

## Publicación separada

Este candidato es **local y no publicado**. Prepararlo no autoriza push, PR, merge ni cambio de tags. El tag local `v0.0.1` existente apunta a un commit anterior y no se mueve. Publicar una versión requiere una decisión posterior sobre commit, etiqueta y artefactos definitivos.
