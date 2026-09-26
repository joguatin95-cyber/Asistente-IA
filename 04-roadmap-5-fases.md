# Roadmap Completo — 5 Fases
### v2 · Asistente IA de Pedidos — 8 semanas, del 21 de septiembre al 13 de noviembre de 2026

> **Nota sobre las fechas.** El plan original arrancaba el 11 de septiembre. Como la construcción
> comienza efectivamente ahora, el calendario se recalibró al lunes **21 de septiembre**, con
> entrega el **13 de noviembre**. Si la fecha de sustentación está fija en el 6 de noviembre, hay
> una variante comprimida al final de este documento.

---

## Vista general

| Fase | Nombre | Fechas | Semanas |
|---|---|---|---|
| 1 | Fundamentos y arquitectura | 21 sept – 4 oct | 1–2 |
| 2 | Backend core (inventario, carrito, órdenes, roles, 2FA) | 5 – 18 oct | 3–4 |
| 3 | Motor de IA (tools, prompt maestro, anti-alucinación/inyección) | 19 – 25 oct | 5 |
| 4 | Frontend (chat cliente + panel admin + panel asesor) | 26 oct – 8 nov | 6–7 |
| 5 | Testing, observabilidad, despliegue y entrega | 9 – 13 nov | 8 |

---

## FASE 1 — Fundamentos y arquitectura (21 sept – 4 oct)

**Objetivo:** dejar listo el esqueleto técnico y los contratos sobre los que se construye todo.

### Tareas
- Crear repositorio con estructura por capas (Domain / Application / Infrastructure /
  Presentation) para el backend NestJS, y proyecto Next.js para el frontend.
- Aplicar **`06-schema.prisma`** tal cual y correr `npx prisma migrate dev --name init`.
- Copiar **`07-env.example`** a `.env` y generar los secretos reales
  (`openssl rand -base64 48` para los JWT y la sesión, `-base64 32` para `ENCRYPTION_KEY`).
- Levantar `docker-compose.yml` (Postgres + Redis) y verificar conexión.
- Escribir el **script de seeds**: negocio demo, superadmin, admin, asesor y ~40 productos.
- Crear cuentas y proyectos externos: Supabase/Neon, Upstash, Anthropic, proveedor SMS, Sentry,
  Vercel, Railway/Render.
- Configurar ESLint + Prettier + Husky y GitHub Actions (lint + test en cada push).
- Desplegar un "hola mundo" a staging (backend y frontend) para validar la cadena de despliegue.

### Entregables
Repositorio con migraciones aplicadas y seeds funcionando · ambientes local y staging operativos ·
CI verde.

### Criterios de aceptación
- `docker-compose up` + `prisma migrate dev` + `prisma db seed` corren sin error desde cero.
- Un push a `main` dispara lint, tests y despliegue a staging.

---

## FASE 2 — Backend core (5 – 18 oct)

**Objetivo:** toda la lógica de negocio funcionando y probada, sin IA ni frontend final.

### Tareas (en este orden)
1. **Catálogo e inventario** — CRUD de `Product` para `ADMIN_NEGOCIO`, `GetCatalogUseCase`,
   `CheckStockUseCase` (disponible = `stockOnHand - stockReserved`), registro de
   `InventoryMovement` en cada ajuste manual.
2. **Autenticación y roles** — registro/login, `argon2`, JWT access + refresh rotativo, **2FA TOTP
   con `otplib`** (QR de configuración), cifrado del `twoFactorSecret`, flujo de recuperación de
   contraseña, guards combinados **rol + `businessId`** en todos los endpoints.
3. **Sesión de cliente y OTP** — `CustomerSession` con cookie httpOnly firmada, `SendOtpUseCase`
   y `VerifyOtpUseCase` con hash del código, contador de intentos y cooldown.
4. **Clientes** — `RegisterOrGetCustomerUseCase` con `dataConsent`/`consentAt`, más los endpoints
   de exportación y supresión de datos (Ley 1581).
5. **Carrito** — `SetCartItemUseCase` (semántica SET, upsert sobre la restricción única),
   `RemoveCartItemUseCase`, `GetCartSummaryUseCase`.
6. **Órdenes** — `ConfirmOrderUseCase` transaccional con reserva atómica y `OrderSequence` para el
   `orderNumber`; cálculo de `paymentDeadline` con Luxon en `BUSINESS_TIMEZONE`.
7. **Ciclo del asesor** — confirmar pago (`PAID`, consumo de stock), liberar, `PREPARING`,
   `SHIPPED`, `DELIVERED`, todo validando la tabla de transiciones del archivo 09.
8. **Edición de orden pagada** — `AmendPaidOrderUseCase`: `OrderAdjustment` por línea, ajuste de
   inventario por delta y generación de la orden `AMENDMENT` cuando hay excedente.
9. **Extensión de plazo** — `ExtendPaymentDeadlineUseCase`, un día, una sola vez.
10. **Job de liberación** — worker BullMQ con `RELEASE_JOB_CRON`, más liberación manual.
11. **Rate limiting** — `@nestjs/throttler` con store Redis en chat, OTP y login.
12. **Tests** — unitarios de cada caso de uso, integración de endpoints y el **test de
    concurrencia** de reservas simultáneas.

### Criterios de aceptación
- Un pedido no pagado se libera solo al vencer el día (verificado con reloj simulado en
  `America/Bogota`) y el stock reservado vuelve a estar disponible.
- Fijar dos veces la misma cantidad de un producto deja esa cantidad, no el doble.
- N reservas concurrentes del último ítem: solo una tiene éxito; se mantiene
  `0 ≤ stockReserved ≤ stockOnHand`.
- Un `ASESOR_VENTAS` no accede a endpoints de catálogo; un `ADMIN_NEGOCIO` no confirma pagos;
  ningún usuario ve datos de otro `businessId`.

---

## FASE 3 — Motor de IA (19 – 25 oct)

**Objetivo:** conectar el modelo al backend ya construido, sin frontend.

### Tareas
- Implementar el `ToolRegistry` con los 13 JSON Schema del **archivo 08**, mapeando cada tool a su
  caso de uso de la Fase 2 y validando argumentos con `zod`.
- Implementar `ChatOrchestrationService`: contexto de la conversación activa → llamada a la API
  con `system` + `tools` → resolución de `tool_use` → `tool_result` → respuesta final. Límite
  `AI_MAX_TOOL_ITERATIONS`; `correlationId` en cada paso.
- Cargar el **prompt maestro** (archivo 02) con inyección de `business.name` y
  `business.advisorName`, y activar prompt caching.
- Implementar el guardrail de salida (verificación de anomalías numéricas) y el retorno de datos
  estructurados para carrito, total y estado.
- Implementar el aislamiento de conversaciones (nueva conversación y carrito en cada regreso) y el
  cierre por inactividad.
- Implementar la degradación: si la API de IA falla o se agota el límite diario, mensaje neutro +
  handoff automático.
- Ejecutar la **suite de 20 pruebas anti-inyección** del archivo 02 y documentar resultados.

### Criterios de aceptación
- Un pedido completo (saludo → consentimiento → OTP → carrito → confirmación) se arma desde
  Postman o un script de consola, sin frontend.
- Ninguna de las 20 pruebas de inyección logra su objetivo.
- Los logs permiten verificar que no se afirmó ningún precio sin su tool previa en el mismo turno.

---

## FASE 4 — Frontend (26 oct – 8 nov)

### Tareas
1. **Chat cliente** — conversación en tiempo real, paso de consentimiento de datos, input del
   código OTP, **tarjetas estructuradas** de carrito/total/estado del pedido, indicador de
   escritura.
2. **Login y 2FA** para roles administrativos, más recuperación de contraseña.
3. **Panel `SUPER_ADMIN`** — gestión de negocios y de admins.
4. **Panel `ADMIN_NEGOCIO`** — catálogo e inventario con edición rápida de stock y precio, carga
   masiva por CSV, gestión de asesores, visión general de órdenes, exportación/supresión de datos
   de clientes.
5. **Panel `ASESOR_VENTAS`** — bandeja de pedidos `PENDING_PAYMENT`, confirmar pago, liberar,
   editar orden pagada (con vista del excedente generado), actualizar estado de envío, bandeja de
   conversaciones en handoff.
6. **Notificaciones en el chat** — cada cambio de estado inserta un mensaje del sistema en la
   conversación del cliente.
7. Revisión de copy y UX: en ningún punto debe leerse como un bot de respuestas fijas ni sugerir
   otro canal de conversación.

### Criterios de aceptación
- Demo completa navegable: cliente entra, verifica OTP, arma pedido, confirma; el asesor lo ve,
  confirma el pago y actualiza el envío; el cliente ve cada notificación en su chat.
- Ninguna ruta del panel es accesible sin el rol correspondiente.

---

## FASE 5 — Testing, observabilidad, despliegue y entrega (9 – 13 nov)

### Tareas
- Suite E2E con Playwright del flujo crítico completo, incluido el caso de liberación por no pago
  y el de edición de orden pagada con excedente.
- Sentry y logging estructurado en staging y producción; métricas de negocio activas.
- Prueba de carga ligera sobre chat y OTP para validar el rate limiting.
- Revisión final de seguridad: 2FA, aislamiento por `businessId`, suite anti-inyección, política
  de datos publicada y consentimiento registrado.
- Despliegue a producción con dominios y secretos definitivos; backups verificados.
- Material de sustentación: los once documentos del proyecto, demo grabada y checklist de
  requisitos punto por punto.

### Criterios de aceptación
- Sistema en producción sin errores críticos durante la demo.
- Checklist de requisitos funcionales completo y verificable.

---

## Variante comprimida (si la entrega es el 6 de noviembre)

Recortar una semana exige tres decisiones de alcance, en este orden de preferencia:

1. **Fusionar las semanas 1–2 en una** (Fase 1 en 21–27 sept): viable porque el schema, el `.env`,
   el contrato de tools y la matriz de permisos ya están escritos; la semana 1 pasa a ser
   ejecución, no diseño.
2. **Diferir a post-MVP**: carga masiva por CSV, panel de `SUPER_ADMIN` (se opera con seeds), y
   métricas de negocio en Grafana (queda solo Sentry).
3. **Reducir el panel de admin a lo indispensable**: editar stock y precio en tabla, sin pantallas
   de gestión de usuarios (los asesores se crean por seed o por endpoint directo).

No recortar, en ningún escenario: el test de concurrencia, la suite anti-inyección, el 2FA y el
job de liberación. Son los cuatro puntos donde una falla es visible y costosa.
