# FocusRead API

Backend de **FocusRead AI**: pasarela de IA multi-proveedor, extracción de texto desde URLs (anti-SSRF),
fragmentación determinista en micro-dosis, cuota diaria y rate limit. Hono + TypeScript (Node 22/24).

> Ningún secreto vive en la app: la key del proveedor por defecto está solo en el servidor; la key propia del
> usuario (BYOK) llega por header y solo existe en memoria durante la petición.

## Cómo correrlo

```bash
npm install
cp .env.example .env     # y rellena DEEPSEEK_API_KEY (con tope de gasto en el panel del proveedor)
npm run dev              # http://localhost:8787  (recarga automática)
```

Otros scripts: `npm run typecheck` · `npm test` · `npm run lint` · `npm run build` · `npm start`.
`dev` y `start` cargan `.env` automáticamente.

### Modos de datos
- `DATA_MODE=memory`: artículos y cuota en memoria, se pierden al reiniciar. Con `NODE_ENV=development`
  y `DEV_AUTH_BYPASS=true` se acepta `Authorization: Bearer dev-<uuid>`.
- `DATA_MODE=live`: Supabase real (B6, verificado). `npm run verify:live` ejecuta 25 comprobaciones contra el
  proyecto dev (crea y borra usuarios de prueba). Exige `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.

## Variables de entorno
Ver `.env.example` (comentado). Se validan al arrancar con zod; si algo falta el proceso termina con un mensaje
claro **sin imprimir valores**. `NODE_ENV=production` prohíbe `DATA_MODE=memory` y `DEV_AUTH_BYPASS=true`.
Solo es obligatoria la key del proveedor por defecto (`DEFAULT_AI_PROVIDER`).

## Endpoints (todos `/v1/*` exigen `Authorization: Bearer <token>`)

Con el bypass de desarrollo:

```bash
TOK="dev-11111111-1111-4111-8111-111111111111"

curl localhost:8787/health

curl localhost:8787/v1/providers -H "authorization: Bearer $TOK"

# Procesar texto (proveedor por defecto, consume cuota diaria)
curl -X POST localhost:8787/v1/articles/process -H "authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"source":{"type":"text","text":"<al menos 300 caracteres>"},"targetDoseMinutes":2.5}'

# Procesar una URL
curl -X POST localhost:8787/v1/articles/process -H "authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"source":{"type":"url","url":"https://ejemplo.com/articulo"},"targetDoseMinutes":2.5}'

# BYOK (no consume cuota)
curl -X POST localhost:8787/v1/articles/process -H "authorization: Bearer $TOK" -H "x-ai-key: <tu-key>" -H "content-type: application/json" \
  -d '{"source":{"type":"text","text":"..."},"targetDoseMinutes":2.5,"provider":"deepseek"}'

# Probar una key BYOK
curl -X POST localhost:8787/v1/providers/test -H "authorization: Bearer $TOK" -H "x-ai-key: <tu-key>" -H "content-type: application/json" \
  -d '{"provider":"deepseek"}'

curl localhost:8787/v1/usage -H "authorization: Bearer $TOK"
curl -X DELETE localhost:8787/v1/account -H "authorization: Bearer $TOK"   # 204
```

Errores: `{ "error": { "code", "message", "requestId" } }` (códigos y HTTP en `src/lib/errors.ts`).
Toda respuesta incluye `X-Request-Id`.

## Apuntar la app Expo
- Emulador Android: `EXPO_PUBLIC_API_URL=http://10.0.2.2:8787`
- Dispositivo físico: la IP de tu PC en la LAN, p. ej. `http://192.168.1.50:8787` (mismo Wi-Fi, firewall abierto al puerto).

## Decisiones y límites
- **CORS desactivado**: el cliente es una app nativa, no un navegador.
- **La IA no escribe el contenido**: las dosis salen del fragmentador (`src/services/chunker.ts`); la IA solo aporta
  título, categoría, resumen, título de cada dosis y quiz, validados con zod (un reintento de reparación y, si falla,
  degradación con `warnings: ["AI_ENRICHMENT_DEGRADED"]` y cuota devuelta).
- **Despliegue**: ver `DEPLOY.md` (comparativa de hostings y pasos para Render).
- **Rate limit en memoria** (por usuario y por IP): válido **solo con una instancia** del servidor. Con varias
  instancias cada una tendría su propio contador.
- **IP del cliente**: último valor de `X-Forwarded-For` (lo añade el proxy más cercano) o la IP del socket.
- **Timeouts**: 90 s globales por petición; la IA tiene 60 s por llamada (`AI_TIMEOUT_MS`) y 80 s en total entre la
  llamada y su reintento.
- **Textos largos**: un artículo de URL de más de `MAX_TEXT_CHARS` (50 000) se recorta en el último párrafo (y a 20
  dosis). El texto pegado por el usuario sí se rechaza si es demasiado largo (`CONTENT_TOO_LONG`).

## Modelo de amenazas (resumen)

| Qué se protege | Amenaza | Cómo | Riesgo aceptado |
|---|---|---|---|
| Keys del servidor (DeepSeek, `service_role`) | Que acaben en la app, en git o en logs | Solo en `.env` (ignorado) o en el hosting; la app nunca las recibe; el logger redacta `Authorization`, `X-AI-Key` y `*.apiKey`/`*.key` y no registra bodies; los logs de error llevan solo el nombre y los frames (sin el mensaje, que podría contener una key); los procesos que fallan (`uncaughtException`) registran solo el nombre | Quien tenga acceso al panel del hosting ve las variables |
| Key BYOK del usuario | Filtración por logs, errores o almacenamiento | Solo en memoria durante la petición; los errores del SDK se convierten a un código del contrato sin copiar su mensaje; nunca se guarda ni se devuelve; probado con `LOG_LEVEL=trace` y con el servidor real | Viaja por TLS hasta el hosting (el HTTPS lo garantiza el hosting) |
| Cuenta y datos del usuario | Suplantación, acceso cruzado entre usuarios | JWT de Supabase verificado con JWKS (issuer, audience, role, solo algoritmos asimétricos); toda lectura con `service_role` filtra por `user_id`; la app lee con RLS | Un JWT robado vale hasta que expire |
| Red interna y metadatos de nube | SSRF al descargar URLs | Validación previa de la URL, IP verificada al conectar (anti DNS rebinding), redirecciones revalidadas (máx. 3), puertos 80/443, límites de tiempo, tamaño y tipo de contenido | Un sitio público puede servir contenido malicioso: solo se extrae texto, nunca se ejecuta |
| El texto que el usuario lee | Prompt injection a través del documento | La IA no escribe el contenido (las dosis salen del fragmentador); el documento va delimitado y tratado como dato; la salida se valida con zod, se repara una vez y, si falla, se degrada | La IA puede generar un quiz o un resumen pobre; el cliente recibe `warnings` si se degrada |
| Dinero (keys con gasto) | Uso abusivo | JWT obligatorio, rate limit por IP (60/min) y por usuario (10/min), cuota diaria por usuario con devolución en fallos, límites de body, texto y descarga, timeouts de IA | El rate limit está en memoria: **solo válido con una instancia**; con varias cada una tendría su contador |
| Disponibilidad | Peticiones lentas o enormes | Timeout global de 90 s, `bodyLimit`, apagado ordenado (SIGTERM/SIGINT) | Una sola instancia: sin alta disponibilidad |
| Integridad de datos | Guardado parcial | Una sola RPC transaccional (`save_processed_article`) | — |

Otras decisiones: cabeceras seguras (`secureHeaders`); errores siempre con el formato del contrato y sin stack, SQL,
URLs internas ni respuestas crudas del proveedor.
