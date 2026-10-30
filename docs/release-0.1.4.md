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
