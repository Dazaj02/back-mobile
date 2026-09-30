# Despliegue (B8)

Datos de hostings verificados en sus páginas oficiales el **2026-09-30** (los planes gratuitos cambian a menudo:
revisa la página antes de contratar).

## Comparativa de hostings

| # | Hosting | Plan gratuito (verificado) | ¿Duerme? | Ajuste con este backend | Veredicto |
|---|---|---|---|---|---|
| 1 | **Render** | Web service gratuito: **750 h/mes por workspace**, una sola instancia, HTTPS (TLS gestionado), sin discos persistentes ni shell. Puede reiniciarse en cualquier momento. | **Sí**: tras 15 min sin tráfico; al despertar tarda **≈1 minuto** | Node nativo con `render.yaml` (sin Docker). Una sola instancia = justo lo que exige el rate limit en memoria. | ✅ **Elegido**: el más simple, sin tarjeta para empezar |
| 2 | **Northflank** (Sandbox) | **2 servicios gratis, siempre encendidos ("no sleeping")**, 1 base de datos, 2 cron jobs; sin caducidad. | **No** | Necesita el `Dockerfile` (incluido, sin probar). No pude confirmar RAM/CPU por servicio ni si pide tarjeta. | ⭐ Mejor alternativa si el arranque lento de Render molesta |
| 3 | **Google Cloud Run** | Capa gratuita mensual compartida por cuenta de facturación: 2 M de peticiones y cientos de miles de vCPU-s / GiB-s (mis fuentes discrepan en las cifras exactas: confírmalas en la página oficial). | Escala a cero (arranque en segundos) | Necesita `Dockerfile` y **cuenta de facturación con tarjeta**. Hay que fijar `--max-instances=1` por el rate limit. | 🟡 Bueno, pero más complejo y con tarjeta |
| 4 | **Zeabur** | Plan Free (sin tarjeta): 1 proyecto, 1 vCPU, 512 MB, 1 GB de disco *(según buscador; la página oficial no detalla cifras)*. | Sí (cold start de unos segundos) | Node/Docker. | 🟡 Opción si no quieres tarjeta |
| 5 | **Railway** | Prueba única de **5 USD que caduca a los 30 días**; después, plan Free con **1 USD/mes** de crédito (0,5 GB, 1 vCPU). Prueba "limitada": salida de red restringida (podría bloquear DeepSeek/Supabase) salvo cuentas de GitHub verificadas. | No documentado | Sirve para probar, no como plan gratis sostenible. | 🔴 No recomendado gratis |
| 6 | **Fly.io** | **No hay capa gratuita**: prueba de 2 h de máquina o 7 días; todas las organizaciones requieren tarjeta. | — | De pago. | 🔴 |
| 7 | **Koyeb** | Su página de precios ya **no ofrece plan gratuito** para web services (Pro desde 29 USD/mes). | — | De pago. | 🔴 |

**Recomendación:** empezar con **Render** (gratis, sin Docker, 10 minutos). Si el arranque de ~1 min tras inactividad
resulta molesto en la demo, pasar a **Northflank** (siempre encendido) o a Render de pago.

### Sobre el arranque en frío de Render
Con el plan gratuito, la primera petición tras 15 min de inactividad tarda ≈1 min. Dos formas de mitigarlo:
1. **En la app:** llamar a `GET /health` al abrirla (sin esperar el resultado) para "despertar" el servidor.
2. **Ping externo** cada ~10 min (p. ej. UptimeRobot) a `/health`: una instancia encendida 24/7 consume ≈744 h/mes,
   dentro de las 750 h gratuitas. Revisa las condiciones de uso de Render antes de depender de esto.

## Despliegue en Render (paso a paso)

Requisito: el código ya está en GitHub (`Dazaj02/back-mobile`, rama `rediseno`).

1. Entra en <https://dashboard.render.com> → **New → Blueprint** → conecta el repositorio `back-mobile`.
2. Render lee `render.yaml` y crea el servicio `focusread-api` (plan *Free*, rama `rediseno`).
3. Te pedirá los **3 secretos** (no están en git; cópialos de tu `.env` local):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DEEPSEEK_API_KEY`
4. Pulsa **Apply** y espera el build (`npm ci --include=dev && npm run build`) y el arranque (`npm start`).
5. Copia la URL HTTPS (`https://focusread-api-XXXX.onrender.com`) → será `EXPO_PUBLIC_API_URL` en la app.
6. Verifica: `curl https://focusread-api-XXXX.onrender.com/health` → `{"status":"ok","version":"1.0.0"}`.
7. En **Logs** comprueba que aparece `server listening` y que no hay tokens ni keys.
8. Prueba el apagado ordenado: *Manual Deploy → Restart* y busca `shutting down` en los logs.
9. Mantén **una sola instancia** (el plan gratuito no permite más; el rate limit es en memoria).

Variables fijadas en `render.yaml` (no secretas): `NODE_VERSION=24`, `NODE_ENV=production`, `DATA_MODE=live`,
`DEV_AUTH_BYPASS=false`, `DEFAULT_AI_PROVIDER=deepseek`, `DEFAULT_AI_MODEL=deepseek-flash`,
`FREE_DAILY_QUOTA=10`, `RATE_LIMIT_PER_MINUTE=10`, `LOG_LEVEL=info`.
En producción el servidor **se niega a arrancar** con `DATA_MODE=memory` o `DEV_AUTH_BYPASS=true`.

## Con Docker (Northflank, Cloud Run, etc.)
`Dockerfile` multi-stage con usuario no root y `HEALTHCHECK` en `/health`. Expone `PORT` (por defecto 8787).
Las mismas variables de entorno se cargan en el panel del hosting. **No se ha podido construir en local** (no hay Docker
en el equipo de desarrollo): pruébalo en el primer despliegue.

## Comprobaciones tras desplegar
- `GET /health` → 200 con `X-Request-Id`.
- Sin token → 401; con `Bearer dev-…` → 401 (el bypass no existe en producción).
- Flujo completo desde la app: login → procesar texto/URL → leer la dosis.
- Logs del hosting sin tokens ni keys.
