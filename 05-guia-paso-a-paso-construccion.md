# Guía Paso a Paso de Construcción
### v2 · Qué hacer, cómo y con qué, semana a semana

Complemento práctico del roadmap. Cada bloque indica acciones concretas, en orden, y qué debe
quedar funcionando antes de avanzar. Pensada para un equipo de 1 a 3 personas.

---

## Día 0 — Preparación (antes del 21 de septiembre)

1. Crear cuentas: GitHub, Vercel, Railway o Render, Supabase o Neon, Upstash, Anthropic Console,
   proveedor SMS (Twilio / Infobip / LabsMobile), Sentry.
2. Instalar: Node.js 20 LTS, Docker Desktop, Postman o Insomnia, un cliente de Postgres.
3. Crear el repo con `backend/` y `frontend/`, y copiar a `backend/prisma/schema.prisma` el
   archivo **06**, y a `backend/.env.example` el archivo **07**.
4. Generar los secretos reales:
   ```bash
   openssl rand -base64 48   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, SESSION_COOKIE_SECRET
   openssl rand -base64 32   # ENCRYPTION_KEY
   ```
5. Dejar `SMS_DRY_RUN=true` en desarrollo: el OTP se imprime en consola y no se gasta un solo SMS.

---

## Semana 1 (21–27 sept) — Esqueleto y datos

1. `nest new backend`; crear la estructura de capas. Sugerencia por módulo de negocio, cada uno
   con sus subcarpetas de capa: `catalog/`, `inventory/`, `cart/`, `order/`, `customer/`, `auth/`,
   `chat/`, `shared/`. Elegir un enfoque y ser consistente.
2. Instalar Prisma (`npm i prisma @prisma/client`), levantar `docker-compose up -d` y correr
   `npx prisma migrate dev --name init`.
3. Escribir `prisma/seed.ts`: negocio demo, `OrderSequence` en 0, un usuario por rol (superadmin,
   admin, asesor) y ~40 productos con stock. Registrar el comando en `package.json`
   (`"prisma": { "seed": "ts-node prisma/seed.ts" }`).
4. Configurar `ConfigModule` de NestJS validando el `.env` con `zod` al arrancar: si falta
   `BUSINESS_TIMEZONE` o `ENCRYPTION_KEY`, la app **no debe levantar**. Ese fallo temprano evita
   errores silenciosos en producción.
5. ESLint + Prettier + Husky; GitHub Actions con lint y tests.

**Fin de semana 1:** `docker-compose up` + `migrate` + `seed` funcionan desde cero y el backend
arranca contra la BD sembrada.

---

## Semana 2 (28 sept–4 oct) — Entornos y despliegue

1. Crear proyectos de staging en Supabase/Neon y Upstash; cargar los secretos en Railway/Render.
2. Configurar el pipeline: push a `main` → lint + test → deploy a staging.
3. `npx create-next-app frontend` con Tailwind; desplegar en Vercel apuntando a un endpoint de
   salud del backend para validar la cadena completa.
4. Copiar al repo los archivos 01, 08 y 09 como `docs/`: son la referencia que se consulta
   mientras se programa.

**Fin de semana 2:** dominios de staging de backend y frontend desplegándose solos desde Git.

---

## Semanas 3–4 (5–18 oct) — Backend core

Orden recomendado y tiempos aproximados:

| Días | Bloque | Notas |
|---|---|---|
| 1–2 | Catálogo e inventario | `CheckStockUseCase` devuelve `stockOnHand - stockReserved`, nunca los campos crudos |
| 3–5 | Auth, 2FA y roles | Guard combinado rol + `businessId` desde el primer endpoint, no después |
| 6–7 | Sesión de cliente y OTP | Hash del código, `attempts`, cooldown; probar con `SMS_DRY_RUN` |
| 8 | Clientes y consentimiento | Incluye exportar/suprimir datos (Ley 1581) |
| 9–10 | Carrito | `SetCartItemUseCase` con semántica SET |
| 11–13 | Órdenes y reserva | Update condicional atómico + `OrderSequence` + Luxon |
| 14–15 | Ciclo del asesor y edición de orden pagada | Validar contra la tabla de transiciones del archivo 09 |
| 16 | Job de liberación (BullMQ) | Probar con reloj simulado |
| 17 | Rate limiting | Throttler con store Redis |
| 18 | Tests pendientes y concurrencia | No dejar el test de concurrencia para el final del proyecto |

Dos detalles que ahorran horas después:

```ts
// Reserva atómica — NO leer y luego escribir
const reserved = await tx.$executeRaw`
  UPDATE "Product" SET "stockReserved" = "stockReserved" + ${qty}
   WHERE "id" = ${productId} AND "active" = true
     AND ("stockOnHand" - "stockReserved") >= ${qty}`;
if (reserved === 0) throw new InsufficientStockError(productId);
```

```ts
// Plazo de pago — SIEMPRE con zona horaria del negocio
const paymentDeadline = DateTime.now()
  .setZone(process.env.BUSINESS_TIMEZONE!)
  .endOf('day').toUTC().toJSDate();
```

**Fin de semana 4:** con Postman se completa el flujo entero (producto → carrito → orden →
pago → stock descontado; y orden vencida → liberada) sin IA ni frontend.

---

## Semana 5 (19–25 oct) — Motor de IA

1. Declarar las 13 tools del archivo 08 en el formato `tools` de la API de Messages.
2. Construir el `ToolRegistry`: mapa `nombre → caso de uso ya existente`. **No reescribir lógica
   de negocio aquí**; si una tool necesita algo que el caso de uso no hace, se corrige el caso de
   uso, no la tool.
3. Construir `ChatOrchestrationService` con el bucle `tool_use → tool_result → respuesta`,
   limitado por `AI_MAX_TOOL_ITERATIONS`.
4. Cargar el prompt maestro con las variables del negocio y activar prompt caching.
5. Devolver el carrito, el total y el estado como **objetos estructurados** además del texto, para
   que el frontend los renderice.
6. Implementar el guardrail de anomalías numéricas y el fallback a handoff.
7. Conectar el OTP real contra el proveedor SMS (probar con tu propio celular, con
   `SMS_DRY_RUN=false` solo en ese momento).
8. Correr la suite de 20 pruebas anti-inyección y dejar el reporte en el repo.

**Fin de semana 5:** un pedido completo armado por chat desde Postman, incluyendo verificación de
identidad y confirmación.

---

## Semanas 6–7 (26 oct–8 nov) — Frontend

| Días | Bloque |
|---|---|
| 1–4 | Chat cliente: mensajes, consentimiento, input de OTP, tarjetas de carrito/total/estado |
| 5–6 | Login + 2FA (QR) + recuperación de contraseña |
| 7–9 | Panel admin: catálogo e inventario con edición en tabla y carga CSV |
| 10–12 | Panel asesor: bandeja, confirmar pago, liberar, editar orden pagada, estados de envío |
| 13 | Notificaciones de estado dentro del chat |
| 14 | Panel superadmin, pulido de UX y copy |

Consejo de implementación: el chat puede arrancar con **polling de 3 segundos** y migrarse a
WebSocket solo si sobra tiempo. Funciona igual para el usuario y elimina una fuente grande de
complejidad en la semana más cargada.

**Fin de semana 7:** demo navegable de punta a punta.

---

## Semana 8 (9–13 nov) — Cierre

1. Suite E2E con Playwright, incluyendo liberación por no pago y edición de orden pagada.
2. Sentry y logs estructurados en producción; métricas de negocio activas.
3. Prueba de carga ligera (`autocannon` o `k6`) sobre chat y OTP.
4. Checklist de seguridad: 2FA, aislamiento por `businessId`, anti-inyección, política de datos
   publicada, consentimiento registrado.
5. Despliegue a producción con dominios y secretos definitivos; verificar backups.
6. Material de sustentación: los once documentos, demo grabada y checklist de requisitos.

---

## Checklist de "listo para empezar"

Antes de escribir la primera línea de código, confirmar que se tiene:

- [ ] `schema.prisma` (archivo 06) copiado y migrado sin errores
- [ ] `.env` (archivo 07) completo, con secretos generados y `BUSINESS_TIMEZONE` puesto
- [ ] `docker-compose.yml` (archivo 10) levantando Postgres y Redis
- [ ] Seeds con negocio demo, tres usuarios y ~40 productos
- [ ] Contrato de las 13 tools (archivo 08) leído por quien vaya a implementar el motor de IA
- [ ] Tabla de transiciones y matriz de permisos (archivo 09) impresa o a la vista
- [ ] Política de tratamiento de datos (archivo 11) adaptada con los datos reales del negocio
- [ ] API key de Anthropic funcionando con una llamada de prueba
- [ ] Cuenta de SMS creada, con `SMS_DRY_RUN=true` en desarrollo

---

## Recomendaciones para mantener el proyecto viable

- **No sobre-diseñar.** Implementar solo las 13 tools y las pantallas del flujo real. Todo lo
  demás es post-MVP.
- **Usar las capas gratuitas** mientras el volumen sea bajo; todas las elegidas tienen free tier
  suficiente para un piloto de un negocio.
- **Controlar el gasto de SMS** en desarrollo con `SMS_DRY_RUN=true`.
- **Escribir los tests junto con cada caso de uso**, no al final. Es lo que hace posible entregar
  en ocho semanas sin sorpresas.
- **Congelar el alcance del catálogo** en ~40 productos para el MVP. Si ampliarlo exigiera cambios
  de arquitectura, algo se diseñó demasiado rígido.
- **Priorizar en caso de retraso:** primero funciona el flujo cliente → pedido → asesor → pago;
  después lo demás. El panel de superadmin y la carga CSV son lo primero que se difiere.
