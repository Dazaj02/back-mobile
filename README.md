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
- `DATA_MODE=memory` (actual): artículos y cuota en memoria, se pierden al reiniciar. Con `NODE_ENV=development`
  y `DEV_AUTH_BYPASS=true` se acepta `Authorization: Bearer dev-<uuid>`.
- `DATA_MODE=live`: Supabase real (B6, verificado). `npm run verify:live` ejecuta 25 comprobaciones contra el proyecto dev (crea y borra usuarios de prueba). Exige `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.

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
- **Rate limit en memoria** (por usuario y por IP): válido **solo con una instancia** del servidor. Con varias
  instancias cada una tendría su propio contador.
- **IP del cliente**: último valor de `X-Forwarded-For` (lo añade el proxy más cercano) o la IP del socket.
- **Timeout global de 90 s** por petición; la IA tiene 60 s por llamada (`AI_TIMEOUT_MS`), y puede haber un reintento.
- Un texto de URL de más de `MAX_TEXT_CHARS` (50 000) se rechaza con `CONTENT_TOO_LONG`.

## Seguridad (resumen; el modelo de amenazas completo llega en B7)
JWT verificado con JWKS de Supabase · anti-SSRF (validación de IP al conectar, redirecciones revalidadas) ·
la key BYOK nunca se registra ni se guarda · logs con redacción de `Authorization` y `X-AI-Key` y sin bodies ·
límites de body, texto, descarga y tiempo.
