# Máquina de Estados, Matriz de Permisos y Reglas de Inventario
### Documento de referencia para implementar guards, transiciones y transacciones

---

## 1. Máquina de estados de `Order`

`PENDING_REVIEW` y `PENDING_PAYMENT` quedaron **fusionados**: el asesor revisa el pedido y
confirma el pago en el mismo paso, sin trabajo redundante.

```
                   confirm_order (asistente)
                            │
                            ▼
                   ┌─────────────────┐
     request_order │ PENDING_PAYMENT │──── vence plazo (job) ──► RELEASED
     _edit ◄───────│                 │──── libera asesor    ──► RELEASED
   (CANCELLED)     └────────┬────────┘
                            │ asesor confirma pago
                            ▼
                         ┌──────┐
                         │ PAID │──── edición en sitio (asesor) ──► PAID (+ orden AMENDMENT si hay excedente)
                         └──┬───┘
                            ▼
                      ┌───────────┐
                      │ PREPARING │
                      └─────┬─────┘
                            ▼
                       ┌─────────┐
                       │ SHIPPED │
                       └────┬────┘
                            ▼
                      ┌───────────┐
                      │ DELIVERED │  (estado final)
                      └───────────┘
```

### Tabla de transiciones permitidas

| Desde | Hacia | Quién | Efecto en inventario | Notifica al cliente |
|---|---|---|---|---|
| — | `PENDING_PAYMENT` | Asistente (`confirm_order`) | `RESERVE`: `stockReserved += qty` | Sí (número de pedido, total, plazo) |
| `PENDING_PAYMENT` | `PAID` | Asesor | `CONSUME`: `stockOnHand -= qty`, `stockReserved -= qty` | Sí (pago confirmado) |
| `PENDING_PAYMENT` | `RELEASED` | `SYSTEM` (job) o Asesor | `RELEASE`: `stockReserved -= qty` | Sí (pedido liberado por no pago) |
| `PENDING_PAYMENT` | `CANCELLED` | Asistente (`request_order_edit`) o Asesor | `RELEASE`: `stockReserved -= qty` | Sí (pedido reabierto para corregir) |
| `PAID` | `PREPARING` | Asesor | — | Sí (en alistamiento) |
| `PREPARING` | `SHIPPED` | Asesor | — | Sí (enviado) |
| `SHIPPED` | `DELIVERED` | Asesor | — | Sí (entregado) |
| `PAID` | `PAID` (ajuste) | Asesor (edición en sitio) | Ajuste por delta, ver sección 3 | Sí (detalle del cambio) |

**Transiciones prohibidas explícitamente** (deben rechazarse en el caso de uso, no solo ocultarse
en la UI): cualquier salto a `PAID` que no venga del asesor; cualquier cambio de estado sobre una
orden `RELEASED`, `CANCELLED` o `DELIVERED`; cualquier transición hecha por el asistente que no
sea `confirm_order` o `request_order_edit`.

Toda transición escribe un `OrderStatusEvent` con `changedBy`, `changedByRole` y `reason`.

---

## 2. Plazo de pago

- **Por defecto:** `paymentDeadline = 23:59:59 del día en que se creó el pedido`, calculado en
  `BUSINESS_TIMEZONE` (`America/Bogota`) y almacenado en UTC.
- **Extensión:** exactamente **un día adicional**, **una sola vez**, y **solo si el cliente lo
  solicita explícitamente** (tool `request_payment_extension`). Nunca se ofrece de forma
  proactiva ni la aplica el sistema por su cuenta. Se marca `deadlineExtended = true`.
- **Liberación automática:** job BullMQ cada 15 minutos (`RELEASE_JOB_CRON`) que busca
  `status = PENDING_PAYMENT AND paymentDeadline < now()` y las pasa a `RELEASED`.
- **Liberación manual:** el asesor puede liberar en cualquier momento una orden no pagada.

Implementación del cálculo (evita el bug clásico de UTC):

```ts
import { DateTime } from 'luxon';

const deadline = DateTime.now()
  .setZone(process.env.BUSINESS_TIMEZONE!)   // America/Bogota
  .endOf('day')                              // 23:59:59.999 local
  .toUTC()
  .toJSDate();
```

---

## 3. Edición de una orden ya pagada (asesor, en sitio)

Regla de negocio acordada: la orden original **se edita en sitio**; si el cambio genera un
**excedente a pagar**, se crea una **orden nueva de tipo `AMENDMENT`** enlazada a la original
por `parentOrderId`.

Procedimiento (todo dentro de una transacción):

1. El asesor ajusta cantidades/productos en el panel. Cada línea modificada genera un
   `OrderAdjustment` con `previousQty`, `newQty`, `deltaQty` y `reason`.
2. **Ajuste de inventario por delta:**
   - `deltaQty > 0` (el cliente pide más): validar disponibilidad; `stockOnHand -= delta`
     (movimiento `CONSUME`) si el excedente se paga de inmediato, o `stockReserved += delta`
     (movimiento `RESERVE`) si queda pendiente de pago en la orden `AMENDMENT`.
   - `deltaQty < 0` (el cliente quita o cambia): `stockOnHand += |delta|` (movimiento `RESTOCK`).
3. **Cálculo del diferencial:**
   - Si el nuevo total **es mayor**: se crea `Order` tipo `AMENDMENT`, estado `PENDING_PAYMENT`,
     con solo los productos adicionales y el valor excedente, `parentOrderId` = orden original, y
     su propio `paymentDeadline` (misma regla: fin del día).
   - Si el nuevo total **es menor o igual**: no se crea orden nueva; el saldo a favor queda
     registrado en `Order.notes` y lo gestiona el asesor por fuera del sistema (devolución o
     abono), quedando la trazabilidad en `OrderAdjustment`.
4. La orden original **conserva su estado `PAID`** y suma su historial de ajustes.
5. Se notifica al cliente dentro del chat: qué cambió, y si hay excedente, el nuevo número de
   pedido y el valor a pagar.

---

## 4. Concurrencia de inventario (obligatorio)

Toda reserva se hace con un **update condicional atómico**, nunca con "leer, comparar, escribir".
Sin esto hay sobreventa en cuanto dos clientes coincidan:

```ts
// Dentro de prisma.$transaction
const reserved = await tx.$executeRaw`
  UPDATE "Product"
     SET "stockReserved" = "stockReserved" + ${qty},
         "updatedAt" = NOW()
   WHERE "id" = ${productId}
     AND "active" = true
     AND ("stockOnHand" - "stockReserved") >= ${qty}
`;
if (reserved === 0) throw new InsufficientStockError(productId);
```

Mismo patrón para el consumo al confirmar el pago:

```ts
const consumed = await tx.$executeRaw`
  UPDATE "Product"
     SET "stockOnHand"   = "stockOnHand"   - ${qty},
         "stockReserved" = "stockReserved" - ${qty}
   WHERE "id" = ${productId}
     AND "stockReserved" >= ${qty}
     AND "stockOnHand"   >= ${qty}
`;
```

Invariante que debe verificarse en tests: `0 <= stockReserved <= stockOnHand` para todo producto,
en todo momento. Un test de concurrencia (N reservas simultáneas del último ítem) debe demostrar
que solo una tiene éxito.

---

## 5. Matriz de permisos

| Acción / endpoint | SUPER_ADMIN | ADMIN_NEGOCIO | ASESOR_VENTAS | Asistente (tool) | Cliente (chat) |
|---|:---:|:---:|:---:|:---:|:---:|
| Crear / desactivar negocios | ✅ | ❌ | ❌ | ❌ | ❌ |
| Crear usuarios internos | ✅ | ✅ (solo su negocio) | ❌ | ❌ | ❌ |
| Crear / editar productos | ❌ | ✅ | ❌ | ❌ | ❌ |
| Ajustar stock manualmente | ❌ | ✅ | ❌ | ❌ | ❌ |
| Ver catálogo | ✅ | ✅ | ✅ | ✅ | ✅ (vía asistente) |
| Ver bandeja de órdenes | ✅ (global) | ✅ (su negocio) | ✅ (su negocio) | ❌ | ❌ |
| Confirmar pago (`→ PAID`) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Liberar orden no pagada | ❌ | ✅ | ✅ | ❌ | ❌ |
| Editar orden pagada | ❌ | ❌ | ✅ | ❌ | ❌ |
| Actualizar estado de envío | ❌ | ❌ | ✅ | ❌ | ❌ |
| Crear orden (`confirm_order`) | ❌ | ❌ | ❌ | ✅ | ❌ (la solicita) |
| Reabrir orden no pagada | ❌ | ❌ | ✅ | ✅ | ❌ (la solicita) |
| Extender plazo de pago | ❌ | ❌ | ✅ | ✅ (solo a petición del cliente) | ❌ |
| Ver / exportar datos de clientes | ✅ | ✅ | ✅ (solo de sus órdenes) | ❌ | Solo los propios |
| Eliminar datos de un cliente (Ley 1581) | ✅ | ✅ | ❌ | ❌ | Lo solicita |
| Ver conversaciones | ✅ | ✅ | ✅ (las asignadas/handoff) | — | Solo la propia |

Reglas de implementación:
- Un `User` tiene **exactamente un rol**. Si una persona cumple dos funciones, se crean dos
  cuentas distintas. No existe arreglo de roles ni herencia entre ellos.
- Todo guard valida **rol + `businessId` del token contra el `businessId` del recurso**. Validar
  solo el rol deja fuga entre negocios.
- `SUPER_ADMIN` administra la plataforma, **no opera ventas**: no puede confirmar pagos ni
  gestionar envíos (evita que el rol técnico se mezcle con el comercial).
- El asistente nunca ejecuta acciones de asesor. Sus únicas escrituras son las 13 tools del
  contrato, y ninguna de ellas toca pagos ni envíos.

---

## 6. Identidad del cliente y aislamiento de datos

1. Al abrir el chat se crea una `CustomerSession` de invitado (token firmado en cookie httpOnly,
   TTL 24 h). En ese momento el sistema **no sabe quién es** y no puede consultar nada.
2. El asistente solicita la autorización de tratamiento de datos (Ley 1581) y el número de
   celular, y envía el OTP.
3. **Hasta que `session.otpVerified = true`, ninguna tool puede devolver datos de un `Customer`
   existente** (nombre, dirección, historial). Esto impide que alguien escriba el número de otra
   persona y obtenga sus datos.
4. Verificado el OTP, la sesión se liga al `Customer` y se abre una `Conversation` con su `Cart`
   en `DRAFT`.
5. `get_order_status` y `request_order_edit` solo operan sobre órdenes de ese `customerId`.
6. **Cada regreso del cliente abre una `Conversation` y un `Cart` nuevos.** El historial de
   conversaciones anteriores nunca se envía como contexto al modelo.

---

## 7. Notificaciones al cliente (sin costo adicional)

Todas las notificaciones ocurren **dentro del chat**: cada cambio de estado de la orden inserta un
`Message` con `role = SYSTEM` en la conversación del cliente. El cliente lo ve en tiempo real si
está conectado (WebSocket), y al reabrir el chat si no lo estaba. Adicionalmente, el frontend
muestra una tarjeta persistente de "estado de mi pedido" con el estado actual leído del backend.

No se envían SMS ni correos de estado: el único SMS del sistema es el OTP de verificación.
