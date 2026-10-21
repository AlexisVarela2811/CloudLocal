# tasks/ui-fixes.md

## Specs

S1: Agregar botón "Volver" con flecha (←) antes del breadcrumb en la vista de archivos. Visible solo cuando folder !== ''. Navega al padre de la carpeta actual.

S2: Modo oscuro no funciona en la pantalla de login. La card blanca flota sobre fondo oscuro. Debe adaptarse al tema oscuro con fondos y textos apropiados.

S3: El botón "Elegir archivos" flota a la derecha en la card de subida. Debe estar alineado a la izquierda dentro del flujo de la card.

S4: Faltan gaps/espaciado entre cards. Se ve apretado y desalineado.

## Tasks

| ID | Spec | Route | Commit |
|----|------|-------|--------|
| T1 | S1: Botón "Volver" antes del breadcrumb | App.tsx | fix(ui): add back button in folder view |
| T2 | S2: Login dark mode y diseño mejorado | index.css, Access.tsx | fix(ui): login dark mode and styling |
| T3 | S3: Botón "Elegir archivos" alineado | index.css | fix(ui): align upload card button |
| T4 | S4: Gaps y espaciado entre cards | index.css | fix(ui): card spacing and layout gaps |
| T5 | Build + test | bash | (automático) |

## Log

L1: Usuario reporta: falta botón atrás en carpetas, modo oscuro no funciona, gap entre elementos, login feo, botón subir flotando a la derecha.