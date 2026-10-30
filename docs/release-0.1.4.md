# CloudLocal 0.1.4 — notas de la versión

Versión de producto 0.1.4 en preparación sobre la rama `release/0.1.4`. Sin tag, sin Release
publicada y sin push: este documento describe lo que cambia en el árbol de trabajo, no un artefacto
publicado. Los assets reales se publican al crear el tag `v0.1.4`, si esa decisión se toma.

## Cambios

### Instalación

- El README ya no apunta a `launcher/dist/CloudLocal.exe` (esa ruta está en `.gitignore` y no
  existe en un clon). La instalación se describe desde las Releases de GitHub, con el patrón de
  nombre de cada asset, las arquitecturas publicadas y los checksums.
- Nueva sección **"Si ves una advertencia"**: SmartScreen en Windows, Gatekeeper y
  `xattr -dr com.apple.quarantine` en macOS, verificación de SHA-256 y la alternativa de compilar
  desde el código fuente.
- Notas de uso explícitas: solo red local (HTTP sin cifrar), equipo servidor encendido, apagado con
  **Apagar** y acceso de otros equipos con la dirección de **Configuración → Servidor**.
- El README incluido dentro del ZIP se adapta a cada plataforma.

### Versiones

- `package.json` de root, `launcher`, `server` y `client` comparten 0.1.4. El `client` estaba en
  `0.0.0` desde el inicio del proyecto.
- `scripts/version.cjs` admite `set X.Y.Z` además de `patch|minor|major`, sincroniza los cuatro
  manifiestos y conserva la indentación de cada archivo.

## Verificar la versión

```sh
node -p "require('./package.json').version"
node -p "require('./client/package.json').version"
```

Los cuatro manifiestos deben devolver el mismo valor, y ese valor debe coincidir con la primera
entrada de `CHANGELOG.md`.

## Empaquetado por plataforma

Cada plataforma se construye sobre su propio sistema: `build.cjs` usa `process.execPath` (el Node que
ejecuta la build) como binario base SEA, así que no hay compilación cruzada en este pipeline. Los
nombres del payload viven en `launcher/scripts/release-layout.cjs`, que leen `build.cjs`, `release.cjs`,
`release-verify.cjs` y `smoke.cjs`.

**windows-x64 — `CloudLocal.exe`**

- Ejecutable SEA con el subsystem del PE cambiado de 3 (consola) a 2 (GUI): el servidor corre sin ventana.
- El icono se inyecta como recurso Windows desde `launcher/scripts/cloudlocal.ico` usando `inject-icon.ps1`.

**darwin-arm64 — `CloudLocal.app`**

- `Contents/MacOS/cloudlocal` (0755): el ejecutable SEA, con el blob en el segmento Mach-O `NODE_SEA`.
- `Contents/Info.plist`: bundle generado por `release-layout.cjs` con `CFBundleExecutable=cloudlocal`,
  `CFBundleIconFile=CloudLocal.icns`, `CFBundleIdentifier=com.cloudlocal.app`, la versión de producto y
  `LSMinimumSystemVersion` 11.0.
- `Contents/Resources/CloudLocal.icns` (0644).
- `build.cjs` retira la firma del binario base antes de inyectar el blob y vuelve a firmar de forma
  *ad-hoc* con `launcher/resources/darwin-entitlements.plist` (`allow-jit`,
  `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`), que V8 necesita en Apple
  Silicon; después lo comprueba con `codesign --verify --strict`. **No hay notarización ni certificado
  de desarrollador.**

**linux-x64**

- `cloudlocal-linux-x64` (0755): ejecutable SEA.
- `CloudLocal.desktop` (0644): entrada de menú con `Exec=cloudlocal` e `Icon=cloudlocal`.
- `cloudlocal.png` (0644): icono de 256×256.
- `install.sh` (0755): instalación por usuario en `~/.local`, sin `root`; `--uninstall` la deshace.

**Común a los tres assets**: `LICENSE`, `NODE-LICENSE.txt`, `THIRD-PARTY-NOTICES.txt`, `README.md`,
`RELEASE-NOTES.md`, `candidate.json` y `SHA256SUMS`. El `README.md` y el `RELEASE-NOTES.md` que viajan
en el ZIP los genera `release.cjs` con las instrucciones de la plataforma de que se trate; no son los
del repositorio. `SHA256SUMS` cubre todos los archivos del candidato menos a sí mismo, y cada ZIP tiene
su checksum en un `<zip>.sha256` aparte.

## Arquitecturas

Se publican exactamente tres: `windows-x64` (x86-64), `linux-x64` (x86-64) y `darwin-arm64` (Apple
Silicon). No existe build para macOS Intel ni para Linux ARM (Raspberry Pi, por ejemplo).

El guard de arquitectura está en `build.cjs` y en `release.cjs`: ambos comparan la arquitectura del
target con `process.arch` y se niegan a producir un artefacto cuyo nombre la falsearía, con el mensaje
`Published targets are windows-x64, linux-x64 and darwin-arm64`. Como el binario base SEA es el Node
del host, una máquina de otra arquitectura tampoco puede generar el ejecutable.

En una arquitectura no publicada queda compilar desde el código fuente y servir desde el repositorio
(`npm ci`, `npm run build:frontend` y `cd server && npm start`, que sirve API y frontend en
`http://localhost:5000`); ver [Desarrollo (desde el código fuente)](../README.md#desarrollo-desde-el-código-fuente).
Añadirla a la superficie publicada exigiría declarar la plataforma en `release-layout.cjs` y un runner
equivalente en `.github/workflows/release.yml`: decisión no tomada.

## Permisos en los ZIP

`release-layout.cjs` fija los modos con `fs.chmodSync` al copiar el payload y los omite en Windows,
cuyo sistema de archivos no tiene bits unix. En el directorio del candidato quedan en 0755
`cloudlocal-linux-x64` e `install.sh` (linux-x64) y `CloudLocal.app/Contents/MacOS/cloudlocal`
(darwin-arm64). Los recursos declarados en la tabla de recursos de Linux y del bundle se copian en 0644,
y `Info.plist` y los documentos comunes se escriben sin `chmod` explícito.

El paso de archivo no reescribe nada: `release.cjs` ejecuta `zip -r -q <zip> .` dentro del directorio
del candidato en Linux y macOS, y `tar.exe` (bsdtar) con `-a -c -f <zip> -C <dir> .` en Windows, donde
no hay bits unix que conservar. Por eso el ZIP de Linux y macOS nace con el 0755 puesto.

Si el extractor del usuario pierde el bit, `chmod +x cloudlocal-linux-x64` lo restaura: es el aviso que
`release.cjs` imprime en el `README.md` del propio ZIP. `release-verify.cjs` compara el modo de cada
archivo en el disco con el que guarda el ZIP cuando se le pasa `--archive`, y
`launcher/test/release-layout.test.cjs` afirma los 0755 del directorio del candidato.

## Iconos

- `launcher/resources/CloudLocal.icns` y `launcher/resources/cloudlocal.png` están versionados en el
  repositorio y se regeneran desde el único origen gráfico, `client/public/cloudlocal.svg`, con
  `node launcher/scripts/make-icons.cjs`. El script usa `sharp` (devDependency de la raíz), arma el
  `.icns` con representaciones PNG codificadas (icp4 16, icp5 32, ic07 128, ic08 256, ic09 512,
  ic10 1024) y escribe el PNG de 256×256. Solo debe ejecutarse cuando cambie el SVG: conservar los
  outputs versionados mantiene las builds offline y deterministas.
- Windows sigue usando `launcher/scripts/cloudlocal.ico`, producido por `make-ico.cjs` e inyectado por
  `build.cjs` en cada build.

El `.icns` y el PNG viajan dentro del ZIP; el `.ico` no se publica, forma parte del `.exe`.

## Verificación de assets

`npm run release:verify -- <directorio-del-candidato> --archive <zip>`
(`launcher/scripts/release-verify.cjs`) recorre el candidato contra la allowlist que
`release-layout.cjs` deriva de la plataforma del host: todos los archivos del payload presentes y ninguno
sobrante, sin symlinks, archivos especiales ni directorios fuera del árbol esperado, el ejecutable como
archivo regular de al menos 64 KiB y un `SHA256SUMS` con una entrada exacta por cada archivo del payload.
En las rutas de `SHA256SUMS` se rechazan `..`, las rutas absolutas y las barras invertidas; las rutas
internas del `.app` son válidas. `candidate.json` debe aportar los campos de procedencia, `unsigned: true`,
`platform` y `arch` iguales al host, la ruta del ejecutable y la lista `payload` del layout, y un `sha256`
que coincida.

Modos y estructura también se comprueban: 0755 para `cloudlocal-linux-x64`, `install.sh` y
`CloudLocal.app/Contents/MacOS/cloudlocal`, y 0644 para el resto; en Windows no se exige modo porque no
hay bits unix. En darwin-arm64 se valida que `Info.plist` sea un plist XML con `CFBundleExecutable`,
`CFBundleIconFile`, `CFBundlePackageType=APPL`, identificador y una versión igual a la de `candidate.json`,
y que el `.icns` empiece con la firma `icns` y declare su longitud real. En linux-x64 se revisa
`CloudLocal.desktop` (`[Desktop Entry]`, `Type=Application`, `Exec`, `Icon=cloudlocal`), que
`cloudlocal.png` sea un PNG de 256×256 y que `install.sh` sea un script POSIX con modo `--uninstall`. Con
`--archive`, el script lee el directorio central del ZIP y exige que contenga exactamente el payload y
que cada entrada conserve el modo que tiene en disco.

`npm run smoke:exe -- <directorio-del-candidato>` (`launcher/scripts/smoke.cjs`) resuelve el artefacto en
este orden: el directorio indicado, el candidato de la plataforma del host en `launcher/dist/release` (el
último por orden alfabético si hay varios) o, si no lo hay, el binario suelto de `launcher/dist`. Antes de
arrancar recorre el payload del candidato: el bundle como directorio, los bits de ejecución del binario y
del instalador, el `CFBundleExecutable` del plist, la firma del `.icns`, la línea `Exec=` del `.desktop`,
la cabecera del PNG y los documentos comunes. Después ejecuta ese binario con `HOME`, `USERPROFILE`, data
y estado apuntando a un fixture temporal bajo `.cache`, y comprueba que el servidor queda listo en
`127.0.0.1` con puerto asignado, que la página y su asset compilado responden, que setup, login, subida,
colisión (409) y descarga funcionan byte a byte, y que el botón **Apagar servidor** termina el proceso con
código 0 y `stderr` vacío.

Ambos pasos corren por plataforma: `.github/workflows/ci.yml` y `.github/workflows/release.yml` invocan
`release:verify` con `--archive` y `smoke:exe` sobre el directorio del candidato. La prueba es del
artefacto nativo del host y no forma parte de `npm test`.

## Pendientes conocidos de la Release

Decisiones abiertas, no correcciones ya aplicadas:

- **Nombres de asset.** Siguen el esquema `<versión>-rc.<n>-<plataforma>.zip`
  (`0.1.4-rc.1-linux-x64.zip`): un asset publicado bajo el tag `v0.1.4` seguirá llamándose "rc.1"
  porque `.github/workflows/release.yml` resuelve `VERSION=${GITHUB_REF_NAME#v}-rc.1`. Es coherente con
  las Releases v0.1.1–v0.1.3 ya publicadas, pero sigue siendo una decisión pendiente.
- **Sin firma de código de pago.** No hay Authenticode en Windows ni notarización de Apple en macOS;
  `candidate.json` lo declara (`unsigned: true`) y los checksums prueban integridad, no identidad del
  editor.
- **No hay icono de bandeja real en ninguna plataforma.** `launcher/src/tray.cjs` solo envía una
  notificación y abre el navegador: toast de PowerShell en Windows, `osascript` en macOS,
  `notify-send` en Linux, con `cmd /c start`, `open` o `xdg-open` para el navegador. Si la herramienta
  no existe en el equipo, el aviso se pierde en silencio.
- **Scripts de icono sin uso en el pipeline, no borrados.** `launcher/scripts/make-ico.cjs`,
  `inject-icon.cjs`, `pe-icon-inspector.cjs` y `w32-icon-injector.py` no los invoca ningún script ni
  workflow: `build.cjs` usa solo `inject-icon.ps1` con `cloudlocal.ico`. `make-icons.cjs` es nuevo y sí
  alimenta los recursos de macOS y Linux.
