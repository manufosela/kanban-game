# Kanban Game — Resumen para el debrief (1 página)

> El juego son **2 rondas del mismo equipo, con el mismo backlog y los mismos dados**.
> Lo **único** que cambia es el límite de WIP. Así, cualquier diferencia es **culpa del WIP**, no de la suerte.

---

## Las métricas, en una línea cada una

| Métrica | Qué significa | Dirección |
|---|---|---|
| 💼 **Valor de negocio entregado** | Lo que de verdad llega al cliente (suma de puntos de valor en Done) | más = mejor |
| 🔧 **Coste en desarrollo** | Esfuerzo entregado (puntos de dev en Done) | — |
| 🎯 **Valor por punto de coste** | Valor ÷ coste. ¿Priorizamos bien? | más = mejor |
| ⏱️ **Tiempo de ciclo** | Cuánto tarda una historia de empezar a terminar | **menos = mejor** |
| 📦 **WIP medio** | Cuánto trabajo a medias hay a la vez | menos = mejor |
| 🗑️ **Coste a medias** | Esfuerzo **empezado y no entregado** (desperdicio del WIP) | menos = mejor |
| 🌊 **Eficiencia de flujo** | % del esfuerzo invertido que **sí** llegó a Done | más = mejor |
| 🍶 **Cuello de botella** | Dónde se atasca el trabajo = dónde actuar | — |
| ⏸️ **Dev parado** | Acciones de dev sin trabajo útil | (dato, no juzga) |

**Las 4 que cuentan la historia:** Valor entregado · Tiempo de ciclo · Eficiencia de flujo · Cuello de botella.

---

## Lo que se suele ver (mismo equipo, solo cambia el WIP)

| | sin WIP | con WIP |
|---|---|---|
| 💼 Valor entregado | menos o igual | **igual o más** |
| ⏱️ Tiempo de ciclo | alto | **3–4× más bajo** |
| 🗑️ Coste a medias | **enorme** (≈ la mitad del esfuerzo varado) | pequeño |
| 🌊 Eficiencia de flujo | ~40% | **~80%** |
| ⚙️ Devs ocupados | 100% | 100% |

> En las dos rondas **nadie está parado**. La diferencia no es "trabajar más", es **terminar lo empezado**.

---

## ⚠️ Matiz clave: el WIP no es magia, es disciplina

El juego **no compara "WIP sí / WIP no"**, compara **disciplina vs sobre-empezar**.

- Un equipo que **se autolimita** en la ronda sin WIP puede **empatar o ganar** a su ronda con WIP. **No es un fallo**: si ya tienes la disciplina, el límite no aporta (y si es demasiado estricto, hasta empeora por starvation del cuello).
- La lección es el **comportamiento** (terminar antes que empezar), **no la regla**. El WIP solo lo hace automático para quien no lo haría solo — casi todo el mundo por defecto.

**Para que se vea:** deja que la ronda **sin WIP** se juegue con el instinto natural (*"mantened a todos ocupados, coged trabajo según entra"*). Si un equipo se autolimita y empata, úsalo como lección avanzada: *"habéis jugado sin WIP como si lo tuvierais; eso es justo lo que perseguimos."*

---

## Frases de oro para el debrief

1. **"Estar ocupado no es entregar valor."**
   Sin WIP los devs están al 100%… pero **más de la mitad de su esfuerzo se queda a medias** y nunca llega al cliente.

2. **"Limitar el WIP no entrega más historias; entrega cada historia MUCHO antes."**
   El premio del WIP es el **tiempo de ciclo** y la **predecibilidad**, no el número de tareas.

3. **"El cuello de botella manda."**
   El sistema entrega al ritmo de su etapa más lenta (aquí, QA). Meter más devs no ayuda: solo infla el trabajo a medias.

4. **"El WIP no es capacidad."**
   Subir el WIP de una columna no la hace más rápida; solo permite más cola. Para ir más rápido en el cuello: **menos retrabajo, gente flexible o más capacidad ahí**.

5. **"El WIP no se hereda ni se inventa: se calcula desde el equipo que tienes."**
   Si cambia el equipo, se recalcula.

---

## Preguntas para lanzar al grupo

- ¿En qué ronda entregasteis **valor** antes? (mirad tiempo de ciclo, no nº de tareas)
- Sin WIP, ¿estabais todos ocupados? Entonces… **¿dónde estaba el desperdicio?** (→ coste a medias)
- ¿Cuál era el **cuello**? ¿Qué pasaría si metierais otro dev? ¿Y otro QA? ¿Y si los devs pudieran testear?
- ¿Por qué "tener a todos ocupados" puede ser **peor** que tener holgura?

---

## Objeciones típicas (y respuesta)

- **"Un dev no puede estar parado, es desperdicio."**
  Cierto. Pero "mantenerlo ocupado" suele significar **empezar trabajo nuevo**, y eso es **peor** desperdicio: trabajo a medias que no llega a Done. La holgura no se rellena con starts nuevos, se **mueve al cuello** (ayudar, mejorar calidad).

- **"Pues metemos más QA."**
  Es una conclusión válida, pero la lección es más amplia: **equilibrar la capacidad al cuello** y hacer a la gente **flexible**; y **limitar el WIP** para *ver* dónde equilibrar.

- **"Subimos el WIP de QA y ya."**
  No. QA no va más rápido; solo acumula más cola → peor tiempo de ciclo, mismo throughput. WIP ≠ capacidad.

---

*Comparativa y métricas en la pantalla de **Resultados** de cada equipo.*
