# Notas del backend — desviaciones y pendientes

Registro vivo, actualizado al cierre de cada fase. Cada ítem indica **qué se necesita** para resolverlo y **quién** lo resuelve.
Estados: 🔴 abierto · 🟡 en espera de un hito · 🟢 cerrado.

## Desviaciones del plan

| # | Fase | Desviación | Por qué | Qué se necesita para resolverla | Estado |
|---|---|---|---|---|---|
| D1 | B0 | El backend vive en la raíz de `back-mobile/`, no en `focusread-api/`. | El repo `back-mobile` ya está conectado a GitHub y la sesión trabaja en él. | Nada si David lo acepta. Si se quiere la ruta literal, mover todo a `focusread-api/`. | 🟡 decisión de David |
| D2 | B0 | Se añadieron `OPENROUTER_API_KEY` y `GROQ_API_KEY` (opcionales) y `DEFAULT_AI_PROVIDER` acepta los 5 proveedores. | El plan lista esos proveedores pero no sus variables de entorno. | Nada; confirmar que se quieren. | 🟢 |
| D3 | B0 | Rama `rediseno` creada a mano; commits sin línea de co-autor. | Instrucción de David. El plan asume que la rama ya existía. | Nada. | 🟢 |
| D4 | B1 | Los tests de validación usan rutas de prueba, no las rutas reales de `/v1/articles/process` y `/v1/providers/test`. | Esas rutas se crean en B5. | Repetir los tests con las rutas reales al terminar B5. | 🟡 se cierra en B5 |
| D5 | B2 | La IP del cliente es el último valor de `X-Forwarded-For`; sin proxy, la IP del socket. | El plan no define cómo obtener la IP. | Confirmar en B8 qué cabeceras pone el hosting elegido y ajustar si hace falta. | 🟡 se cierra en B8 |
| D6 | B2 | Los tests toman un 404 en `/v1/x` como "autenticación superada". | Aún no hay rutas `/v1`. | Cambiar a rutas reales en B5. | 🟡 se cierra en B5 |
| D7 | B3 | `AIProvider.enrich` recibe un campo opcional extra `repair` ({previous, error}). | El plan exige un reintento de reparación reenviando el error de validación, pero la interfaz no tenía dónde llevarlo. | Nada; queda documentado. | 🟢 |
| D8 | B3 | Gemini usa `responseMimeType: 'application/json'` pero **no** `responseSchema`. | La validación estricta ya se hace con zod + reparación; el esquema de Gemini duplicaría el contrato. | Añadirlo solo si las pruebas reales con Gemini muestran salidas inválidas frecuentes. | 🟢 |
| D9 | B3 | `providers.ts` y el registry aceptan `openrouter` con un solo modelo. | La documentación de OpenRouter no lista IDs concretos (ver P7). | Ver P7. | 🟡 |
| D10 | B3 | `package.json`: `dev` y `start` cargan `.env` con `--env-file-if-exists`. | Node no lo carga solo y el plan no lo especifica. | Nada. | 🟢 |

## Pendientes y riesgos

| # | Fase | Pendiente | Qué se necesita | Quién | Estado |
|---|---|---|---|---|---|
| P1 | B0 | Sin `push` a GitHub de las fases B0–B3 (commits locales en `rediseno`). | Que David pida el push (o lo haga él). | David | 🔴 |
| P2 | B0 | `DEFAULT_AI_MODEL`. | Resuelto: `deepseek-flash` (ID verificado en la documentación de DeepSeek) ya está en `.env` y `.env.example`. | — | 🟢 |
| P3 | B2 | El JWKS remoto de Supabase no se ha probado contra un proyecto real. | Proyecto Supabase dev con llaves de firma JWT asimétricas (hito H2). | David | 🟡 H2 |
| P4 | B2 | Rate limit en memoria: solo válido con **una** instancia. | Documentarlo en el README (B5) y desplegar con una sola instancia (B8). | Claude | 🟡 B5/B8 |
| P5 | B3 | Los IDs se consultaron con WebFetch (resumen automático de la documentación). DeepSeek, Gemini y Groq son fiables; **OpenAI** (`gpt-6-luna`) viene de una sola fuente y **sin confirmar** soporte de `response_format`. | Revisar manualmente https://developers.openai.com/api/docs/models o probar con una key real. | David / Claude | 🔴 |
| P6 | B3 | Los proveedores solo se probaron con `fetch`/cliente simulado; **nunca contra la API real**. | Pegar la key de DeepSeek en `.env` (`DEEPSEEK_API_KEY=`) y hacer una llamada real (se hace en B5 con el flujo completo). | David | 🔴 |
| P7 | B3 | OpenRouter: sin IDs verificados en la documentación; se dejó `openai/gpt-oss-20b` (formato `org/modelo`) solo como marcador. | Consultar https://openrouter.ai/models y elegir 1–3 modelos con salida JSON, o quitar OpenRouter si no se usará. | David | 🔴 |
| P8 | B3 | El JSON mode de Gemini y el fallback sin `response_format` (400) solo están probados con mocks. | Pruebas reales con key de Gemini (opcional). | David | 🟡 opcional |
