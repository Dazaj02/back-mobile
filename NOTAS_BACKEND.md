# Notas del backend — desviaciones y pendientes

Registro vivo, actualizado al cierre de cada fase. Cada ítem indica **qué se necesita** para resolverlo y **quién** lo resuelve.
Estados: 🔴 abierto · 🟡 en espera de un hito · 🟢 cerrado.

## Desviaciones del plan

| # | Fase | Desviación | Por qué | Qué se necesita para resolverla | Estado |
|---|---|---|---|---|---|
| D1 | B0 | El backend vive en la raíz de `back-mobile/`, no en `focusread-api/`. | El repo `back-mobile` ya está conectado a GitHub y la sesión trabaja en él. | Nada: David decidió dejarlo así. | 🟢 aceptada |
| D2 | B0 | Se añadieron `OPENROUTER_API_KEY` y `GROQ_API_KEY` (opcionales) y `DEFAULT_AI_PROVIDER` acepta los 5 proveedores. | El plan lista esos proveedores pero no sus variables de entorno. | Aceptada. Las variables quedan vacías en `.env` para llenarlas cuando se usen (hoy solo DeepSeek). | 🟢 aceptada |
| D3 | B0 | Rama `rediseno` creada a mano; commits sin línea de co-autor. | Instrucción de David. El plan asume que la rama ya existía. | Nada. | 🟢 |
| D4 | B1 | Los tests de validación usan rutas de prueba, no las rutas reales de `/v1/articles/process` y `/v1/providers/test`. | Esas rutas se crean en B5. | Hecho: `test/integration/api.test.ts` prueba bodies válidos e inválidos en las rutas reales. | 🟢 cerrada en B5 |
| D5 | B2 | La IP del cliente es el último valor de `X-Forwarded-For`; sin proxy, la IP del socket. | El plan no define cómo obtener la IP. | Confirmar en B8 qué cabeceras pone el hosting elegido y ajustar si hace falta. | 🟡 se cierra en B8 |
| D6 | B2 | Los tests tomaban un 404 en `/v1/x` como "autenticación superada". | No había rutas `/v1`. | Hecho: `b2.test.ts` usa `/v1/usage` (200 = autenticado). | 🟢 cerrada en B5 |
| D7 | B3 | `AIProvider.enrich` recibe un campo opcional extra `repair` ({previous, error}). | El plan exige un reintento de reparación reenviando el error de validación, pero la interfaz no tenía dónde llevarlo. | Nada; queda documentado. | 🟢 |
| D8 | B3 | Gemini usa `responseMimeType: 'application/json'` pero **no** `responseSchema`. | La validación estricta ya se hace con zod + reparación; el esquema de Gemini duplicaría el contrato. | Añadirlo solo si las pruebas reales con Gemini muestran salidas inválidas frecuentes. | 🟢 |
| D9 | B3 | `providers.ts` y el registry aceptan `openrouter` con un solo modelo. | La documentación de OpenRouter no lista IDs concretos (ver P7). | Ver P7. | 🟡 |
| D10 | B3 | `package.json`: `dev` y `start` cargan `.env` con `--env-file-if-exists`. | Node no lo carga solo y el plan no lo especifica. | Nada. | 🟢 |

| D11 | B4 | Una respuesta mayor a `URL_MAX_BYTES` **falla** con `URL_FETCH_FAILED` en vez de truncarse. | El plan dice "cortando en URL_MAX_BYTES" pero lista ese caso entre los tests de bloqueo; truncar podría entregar un artículo incompleto sin avisar. | Nada; si se prefiere truncar, es un cambio de una línea en `readLimited`. | 🟢 |
| D12 | B4 | El bloqueo de `localhost` / `*.localhost` se hace por nombre antes de resolver DNS, además de la validación de IP al conectar. | Defensa en profundidad; el plan solo exige la validación al conectar. | Nada. | 🟢 |

| D13 | B5 | El fragmentador fuerza `estMinutes ≥ 0.1` y parte por palabras cualquier "oración" de más de 12 000 caracteres. | El contrato exige `estMinutes > 0` y `content ≤ 20000`; sin esto, un fragmento diminuto o un texto sin puntuación harían fallar la validación de salida con `INTERNAL`. | Nada. | 🟢 |
| D14 | B5/B6 | `QuotaStore` tiene un método extra `usage()`. En live se implementa con `consume_ai_quota(límite 1)` (+ `refund` si llegó a consumir). | `GET /v1/usage` necesita el consumo, y el contrato SQL (§3.5) solo trae `consume` y `refund`. Con límite 0 la función devuelve siempre `used=0`, por eso no sirve. | Sustituir por una función de lectura: ver P10. | 🟡 apaño temporal |
| D15 | B5 | Al crear el artículo, `aiProvider` guarda el proveedor real (p. ej. `deepseek`), no el alias `focusread`. | Es más informativo y el contrato lo permite (`string`). | Nada. | 🟢 |

| D16 | B8 | Hosting elegido: **Render** (plan gratuito, Node nativo). `Dockerfile` incluido como alternativa, sin construir. | Mejor relación simplicidad/coste hoy; ver `DEPLOY.md` para la comparativa verificada. Una sola instancia cumple P4. | Nada. | 🟢 |

## Pendientes y riesgos

| # | Fase | Pendiente | Qué se necesita | Quién | Estado |
|---|---|---|---|---|---|
| P1 | B0 | Push a GitHub. | Hecho: rama `rediseno` subida a `origin` (B0–B3). Se repite al cerrar cada fase. | — | 🟢 |
| P2 | B0 | `DEFAULT_AI_MODEL`. | Resuelto: `deepseek-flash` (ID verificado en la documentación de DeepSeek) ya está en `.env` y `.env.example`. | — | 🟢 |
| P3 | B2 | JWKS remoto de Supabase. | Hecho en B6: JWT reales ES256 (login con usuarios de prueba) aceptados; token alterado o ausente → 401; el bypass `dev-<uuid>` no funciona en live. | — | 🟢 |
| P4 | B2 | Rate limit en memoria: solo válido con **una** instancia. | Documentarlo en el README (B5) y desplegar con una sola instancia (B8). | Claude | 🟡 B5/B8 |
| P9 | B4 | Extracción con páginas reales. | Hecho en B5: BBC Mundo (portada) y un ensayo de paulgraham.com se procesaron bien; metadatos de nube y `localhost` se bloquean. | — | 🟢 |
| P10 | B5/B6 | El contrato SQL (§3.5) no tiene una función de lectura del consumo de cuota (no hay tabla expuesta ni función). `GET /v1/usage` usa el apaño de D14, que funciona pero hace 1–2 llamadas extra y, si el consumo es 0, sube y baja el contador un instante. | Pedir al agente de BD: `get_ai_quota_usage(p_user_id uuid) returns int` (solo `service_role`). Luego cambio `usage()` a una sola llamada RPC. | David → agente DB | 🟡 mejora |
| P13 | B6 | La `SUPABASE_SERVICE_ROLE_KEY` se pegó por error en `.env.example` (archivo versionado). Se movió a `.env` y se limpió antes de cualquier commit; el historial de git no la contiene y no se subió a GitHub. Además es una key *legacy* (JWT `eyJ…`). | Opcional: rotarla en Supabase (Settings → API) si hay dudas de exposición, y usar la nueva `sb_secret_…` cuando quieras. Ante todo: las keys solo van en `.env`. | David | 🟡 recomendado |
| P14 | B6 | La base crea 3 artículos `demo` al registrar un usuario (lo hace el esquema, no el backend). | Nada; solo saberlo al contar filas. | — | 🟢 informativo |
| P11 | B5/B7 | Artículos largos por URL. | Resuelto en B7 (decisión de David): se recortan a 50 000 caracteres en el último párrafo y a 20 dosis. El texto pegado por el usuario se sigue rechazando. **El aviso no es posible sin cambiar el contrato** (ver C1). | — | 🟢 |
| P12 | B5/B7 | Timeout global (90 s) vs. dos llamadas de IA de 60 s. | Resuelto en B7: plazo total de 80 s compartido por la llamada y su reintento (la reparación hereda solo el tiempo restante). Esto destapó un bug real: `AbortSignal.timeout` exige entero. | — | 🟢 |
| P17 | B8 | **El despliegue real lo tiene que hacer David**: requiere su cuenta de Render y cargar 3 secretos en el panel; yo no tengo acceso a su cuenta. Todo está preparado (`render.yaml`, `DEPLOY.md`) y verificado en local con el build de producción. | Seguir `DEPLOY.md` (≈10 min) y pasarme la URL HTTPS para cerrar B8 (verificar `/health`, el flujo desde la app y los logs del hosting). | David | 🔴 |
| P18 | B8 | El `Dockerfile` no se pudo construir (no hay Docker en el equipo). | Probarlo en el primer despliegue con Docker (Northflank/Cloud Run) o instalar Docker Desktop. No se necesita para Render. | David / Claude | 🟡 solo si se usa Docker |
| P19 | B8 | Render gratis: duerme a los 15 min y despierta en ≈1 min. RAM/CPU del plan gratuito no verificados en la documentación. | En la app, llamar a `/health` al abrir (frontend) o usar un ping externo; o pasar a Northflank (siempre encendido). | David / agente frontend | 🟡 |
| P15 | B7 | El apagado ordenado (SIGTERM) está implementado pero **no se pudo probar en Windows** (allí `kill` termina el proceso sin ejecutar el handler). | Probar en el hosting de Linux (B8): enviar SIGTERM al contenedor y comprobar el log `shutting down`. | Claude en B8 | 🟡 B8 |
| P16 | B7 | En producción, `X-AI-Key` solo debería viajar por HTTPS: lo garantiza el hosting, el backend no lo fuerza. | Confirmar en B8 que el hosting fuerza HTTPS (redirección o bloqueo de HTTP). | Claude en B8 | 🟡 B8 |

## Cambios de contrato que quedarían por decidir (NO aplicados)

| # | Cambio | Por qué | Quién decide |
|---|---|---|---|
| C1 | Añadir el warning `CONTENT_TRUNCATED` a `ProcessWarningSchema`. | Para avisar al usuario de que un artículo largo por URL se recortó. Hoy el recorte es silencioso porque el contrato congelado solo admite `AI_ENRICHMENT_DEGRADED` y un valor nuevo rompería la validación del frontend. | David (afecta a frontend y backend) |
| P5 | B3 | (David solo usa DeepSeek; OpenAI queda sin verificar, sin uso por ahora.) Los IDs se consultaron con WebFetch (resumen automático de la documentación). DeepSeek, Gemini y Groq son fiables; **OpenAI** (`gpt-6-luna`) viene de una sola fuente y **sin confirmar** soporte de `response_format`. | Revisar manualmente https://developers.openai.com/api/docs/models o probar con una key real. | David / Claude | 🔴 |
| P6 | B3 | Proveedores probados solo con simulaciones. | Hecho en B5: llamada real a DeepSeek (`deepseek-flash`) con texto y URLs → 201, resumen, categoría y quiz válidos (4–14 s). | — | 🟢 |
| P7 | B3 | OpenRouter: sin IDs verificados; `openai/gpt-oss-20b` es solo un marcador. David no usa OpenRouter por ahora. | Cuando se use: elegir modelos en https://openrouter.ai/models. | David | 🟡 aplazado |
| P8 | B3 | JSON mode de Gemini y fallback sin `response_format` solo probados con mocks. David lo da por bueno. | Nada por ahora. | — | 🟢 aceptado |
