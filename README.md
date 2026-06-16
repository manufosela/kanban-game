# Kanban Game — El juego de los tableros Kanban

Aplicación web para jugar al **Kanban Game** en dos rondas: la **Ronda 1 sin límite de WIP**
y la **Ronda 2 con límite de WIP** por columna. Login con Google, gestión de equipos,
tableros con columnas configurables, motor de juego por turnos con dados y métricas con gráficas.

- **Stack:** Astro (estático) · Firebase (Auth Google · Realtime Database · Hosting) · Vanilla JS (ES2025) · Web Components con Lit. Sin TypeScript, sin Tailwind, sin librerías de gráficas (SVG a mano).
- **Producción:** https://el-juego-kanban.web.app

## Puesta en marcha (local)

```bash
cp .env.example .env   # ya trae la config pública del proyecto; ajusta PUBLIC_ADMIN_EMAILS
npm install
npm run dev
```

## Configuración de Firebase requerida (una vez)

> El proveedor de Google **debe habilitarse en consola** (crea el cliente OAuth automáticamente; no se puede por API/CLI).

1. Consola → **Authentication → Sign-in method → Google → Habilitar** (elige un email de soporte) → Guardar.
   - Enlace directo: https://console.firebase.google.com/project/kanban-game-a51ad/authentication/providers
2. (Ya hecho) Realtime Database creada y reglas desplegadas (`database.rules.json`).
3. (Ya hecho) Hosting desplegado.

El **primer usuario** que entre en una base de datos vacía será **admin**. Además, cualquier
email listado en `PUBLIC_ADMIN_EMAILS` (en `.env`, no versionado) será admin al registrarse.

## Cómo se juega

1. Un **admin** crea equipos y un tablero, configura columnas y (para la Ronda 2) los límites WIP.
2. El admin asigna a cada persona un **rol de juego**: PM, Dev o QA.
3. El admin inicia una ronda. Cada turno tiene **5 pasos** (PM mete historias → PM tira para Análisis →
   Devs actúan → QA prueba → PM valida a Done). El dado decide: **1-2 no avanza, 3+ avanza**.
4. Tras 10 turnos termina la ronda. En **Resultados** se ven throughput, diagrama de flujo (CFD),
   cuello de botella y la comparativa Ronda 1 vs Ronda 2.

### Nota sobre las reglas
En el documento original, el paso de QA menciona "Revisión PR" como origen, pero la opción B del Dev
ya mueve *Revisión PR → QA* y la columna QA tiene WIP propio. Para que ninguna columna sea un callejón
sin salida, aquí **QA prueba la columna QA** y la pasa a *Validación PM* (bug → vuelve a *Desarrollo*).

## Scripts

```bash
npm run dev            # desarrollo
npm test               # tests de la lógica de reglas (vitest)
npm run build          # build estático en dist/
npm run deploy         # build + firebase deploy (hosting + reglas)
npm run deploy:rules   # solo reglas RTDB
```

## Estructura

```
src/lib/rules.js     Lógica pura del juego (testeable, sin Firebase)
src/lib/game.js      Motor de partida sobre RTDB (transacciones, 5 pasos)
src/lib/db.js        Equipos, tableros, columnas, WIP, asignaciones
src/lib/session.js   Auth Google, alta de usuario, rol, guards
src/components/      Web Components Lit (tablero, dado, admin, gráficas)
src/pages/           index (login) · dashboard · admin · board · results
database.rules.json  Reglas de seguridad de Realtime Database
```
