# Contrato de Herramientas (ToolRegistry)
### JSON Schema de cada tool, caso de uso asociado, validaciones y errores

Este es el contrato entre el motor de IA y el backend. Cada `tool_use` que devuelve la API de
Anthropic se resuelve aquí. **Ninguna tool recibe precios, totales ni descuentos como parámetro**:
esos valores siempre se calculan server-side desde el catálogo, sin importar qué intente pasar
el modelo o qué escriba el cliente.

Reglas transversales:
- Toda tool recibe implícitamente del contexto de ejecución (no del modelo): `businessId`,
  `conversationId`, `sessionId`, y `customerId` si la sesión ya está verificada.
- Toda tool de escritura valida primero el estado de la sesión (`otpVerified`) y la propiedad del
  recurso (`conversationId` de la sesión actual).
- Toda tool devuelve `{ ok: true, data }` o `{ ok: false, error: { code, message } }`. El código
  de error se traduce a una respuesta natural del asistente; el `message` técnico nunca se
  muestra al cliente.
- Toda tool de escritura acepta `idempotency_key` opcional; si llega repetida en menos de 60s,
  devuelve el resultado anterior sin re-ejecutar.

---

## 1. `send_otp`

Envía el código de verificación al celular del cliente. **Se llama al INICIO de la conversación**,
antes de mostrar cualquier dato de cliente o armar pedido.

```json
{
  "name": "send_otp",
  "description": "Envía un código de verificación por SMS al celular del cliente. Debe llamarse al inicio, antes de cualquier otra operación, y solo después de que el cliente haya aceptado el tratamiento de datos.",
  "input_schema": {
    "type": "object",
    "properties": {
      "phone": {
        "type": "string",
        "description": "Número de celular del cliente en formato nacional de 10 dígitos, sin espacios ni símbolos."
      }
    },
    "required": ["phone"]
  }
}
```
**Caso de uso:** `SendOtpUseCase` · **Errores:** `OTP_COOLDOWN`, `OTP_DAILY_LIMIT`, `INVALID_PHONE`, `SMS_PROVIDER_DOWN`

---

## 2. `verify_otp`

```json
{
  "name": "verify_otp",
  "description": "Verifica el código recibido por el cliente. Si es correcto, habilita la sesión para operar. Sin esta verificación no se puede consultar ni registrar datos del cliente.",
  "input_schema": {
    "type": "object",
    "properties": {
      "code": { "type": "string", "description": "Código de 6 dígitos ingresado por el cliente." }
    },
    "required": ["code"]
  }
}
```
**Caso de uso:** `VerifyOtpUseCase` · **Efecto:** `CustomerSession.otpVerified = true` · **Errores:** `OTP_INVALID`, `OTP_EXPIRED`, `OTP_MAX_ATTEMPTS` (→ handoff)

---

## 3. `register_or_get_customer`

```json
{
  "name": "register_or_get_customer",
  "description": "Registra un cliente nuevo o recupera uno existente. Solo puede llamarse con la sesión ya verificada por OTP.",
  "input_schema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Nombre del cliente." },
      "address": { "type": "string", "description": "Dirección de envío." },
      "data_consent": {
        "type": "boolean",
        "description": "true únicamente si el cliente aceptó explícitamente el tratamiento de sus datos en este chat."
      }
    },
    "required": ["data_consent"]
  }
}
```
**Caso de uso:** `RegisterOrGetCustomerUseCase` · **Errores:** `SESSION_NOT_VERIFIED`, `CONSENT_REQUIRED`

---

## 4. `get_catalog`

```json
{
  "name": "get_catalog",
  "description": "Devuelve los productos activos del negocio con su precio y disponibilidad real. Única fuente válida de información de productos.",
  "input_schema": {
    "type": "object",
    "properties": {
      "search": { "type": "string", "description": "Texto opcional para filtrar por nombre." },
      "only_available": { "type": "boolean", "description": "Si es true, omite productos sin stock disponible." }
    },
    "required": []
  }
}
```
**Caso de uso:** `GetCatalogUseCase` · **Devuelve:** `[{ product_id, name, price, available }]` (nunca `stockOnHand` ni `stockReserved` crudos)

---

## 5. `check_stock`

```json
{
  "name": "check_stock",
  "description": "Verifica la disponibilidad real de un producto. Debe llamarse antes de ofrecer o agregar cualquier producto al carrito.",
  "input_schema": {
    "type": "object",
    "properties": {
      "product_id": { "type": "string" },
      "quantity": { "type": "integer", "minimum": 1, "description": "Cantidad que se desea verificar." }
    },
    "required": ["product_id", "quantity"]
  }
}
```
**Caso de uso:** `CheckStockUseCase` · **Devuelve:** `{ available: boolean, available_quantity: number }`

---

## 6. `set_cart_item`  ← reemplaza a `add_item_to_cart`

Semántica **SET, no ADD**: si el cliente repite la confirmación, la cantidad final es la indicada,
nunca la suma. Esto elimina el doble ingreso de raíz.

```json
{
  "name": "set_cart_item",
  "description": "Establece la cantidad FINAL de un producto en el carrito. No suma: si el producto ya está, reemplaza la cantidad por la indicada. Para quitar un producto usa remove_cart_item.",
  "input_schema": {
    "type": "object",
    "properties": {
      "product_id": { "type": "string" },
      "quantity": { "type": "integer", "minimum": 1, "description": "Cantidad total deseada de este producto en el carrito." },
      "idempotency_key": { "type": "string" }
    },
    "required": ["product_id", "quantity"]
  }
}
```
**Caso de uso:** `SetCartItemUseCase` (upsert sobre `@@unique([cartId, productId])`, validando stock disponible) · **Errores:** `INSUFFICIENT_STOCK`, `PRODUCT_INACTIVE`, `CART_LOCKED`

---

## 7. `remove_cart_item`

```json
{
  "name": "remove_cart_item",
  "description": "Quita un producto del carrito.",
  "input_schema": {
    "type": "object",
    "properties": { "product_id": { "type": "string" } },
    "required": ["product_id"]
  }
}
```

---

## 8. `get_cart_summary`

```json
{
  "name": "get_cart_summary",
  "description": "Devuelve el contenido actual del carrito con cantidades, precios unitarios y total. Debe llamarse antes de pedir la confirmación final.",
  "input_schema": { "type": "object", "properties": {}, "required": [] }
}
```
**Nota de implementación:** el resultado se renderiza en el frontend como **tarjeta estructurada**.
El asistente acompaña con texto pero no reescribe las cifras: así se elimina la clase entera de
errores numéricos del modelo.

---

## 9. `confirm_order`

```json
{
  "name": "confirm_order",
  "description": "Cierra el carrito y genera la orden de venta. Solo puede llamarse tras mostrar el resumen y recibir confirmación explícita del cliente.",
  "input_schema": {
    "type": "object",
    "properties": {
      "customer_confirmed": {
        "type": "boolean",
        "description": "true solo si el cliente confirmó explícitamente el resumen mostrado."
      },
      "idempotency_key": { "type": "string" }
    },
    "required": ["customer_confirmed"]
  }
}
```
**Caso de uso:** `ConfirmOrderUseCase` (transaccional: reserva stock, crea `Order` en
`PENDING_PAYMENT`, asigna `orderNumber`, calcula `paymentDeadline` = 23:59:59 del día actual en
`BUSINESS_TIMEZONE`, registra `InventoryMovement` tipo `RESERVE`) ·
**Devuelve:** `{ order_number, total, payment_deadline }` ·
**Errores:** `EMPTY_CART`, `INSUFFICIENT_STOCK`, `CUSTOMER_INCOMPLETE`, `SESSION_NOT_VERIFIED`

---

## 10. `get_order_status`

```json
{
  "name": "get_order_status",
  "description": "Consulta el estado real de un pedido del cliente actual. Nunca deduzcas el estado por el tiempo transcurrido.",
  "input_schema": {
    "type": "object",
    "properties": {
      "order_number": { "type": "string", "description": "Opcional. Si se omite, devuelve el pedido más reciente del cliente." }
    },
    "required": []
  }
}
```
**Restricción dura:** solo devuelve órdenes cuyo `customerId` coincide con el de la sesión
verificada. Cualquier otro `order_number` responde `ORDER_NOT_FOUND`, nunca "existe pero no es tuyo".

---

## 11. `request_payment_extension`

```json
{
  "name": "request_payment_extension",
  "description": "Extiende el plazo de pago un (1) día adicional. Solo a solicitud explícita del cliente y una sola vez por pedido.",
  "input_schema": {
    "type": "object",
    "properties": {
      "order_number": { "type": "string" },
      "customer_requested": { "type": "boolean", "description": "true solo si el cliente lo pidió explícitamente." }
    },
    "required": ["order_number", "customer_requested"]
  }
}
```
**Caso de uso:** `ExtendPaymentDeadlineUseCase` · **Errores:** `ALREADY_EXTENDED`, `ORDER_NOT_EXTENDABLE` (ya pagada/liberada/cancelada)

---

## 12. `request_order_edit`

Solo aplica a órdenes **no pagadas**. Cancela la orden, devuelve la reserva de inventario y
reabre el carrito para que el cliente corrija. (La edición de una orden **ya pagada** NO pasa por
aquí: la hace el asesor en el panel — ver sección 7 del blueprint.)

```json
{
  "name": "request_order_edit",
  "description": "Reabre un pedido aún no pagado para que el cliente lo corrija. Cancela la orden actual y devuelve los productos al carrito.",
  "input_schema": {
    "type": "object",
    "properties": {
      "order_number": { "type": "string" },
      "reason": { "type": "string" }
    },
    "required": ["order_number"]
  }
}
```
**Caso de uso:** `ReopenOrderForEditUseCase` (transaccional: `Order → CANCELLED`, `InventoryMovement` tipo `RELEASE`, `Cart → DRAFT` con los ítems restaurados) · **Errores:** `ORDER_ALREADY_PAID` (→ handoff al asesor), `ORDER_NOT_FOUND`

---

## 13. `handoff_to_advisor`

```json
{
  "name": "handoff_to_advisor",
  "description": "Escala la conversación a la asesora de ventas humana.",
  "input_schema": {
    "type": "object",
    "properties": {
      "reason": {
        "type": "string",
        "enum": ["CLIENTE_LO_PIDIO", "FUERA_DE_ALCANCE", "SIN_RESPUESTA_2_TURNOS", "OTP_FALLIDO", "PEDIDO_PAGADO_REQUIERE_CAMBIO", "INTENTO_SOSPECHOSO", "ERROR_TECNICO"]
      },
      "summary": { "type": "string", "description": "Resumen breve de lo que necesita el cliente." }
    },
    "required": ["reason"]
  }
}
```
**Caso de uso:** `HandoffToAdvisorUseCase` · **Efecto:** `Conversation.status = HANDED_OFF` + notificación al panel del asesor con el resumen estructurado del carrito/orden (no el chat completo).

---

## Catálogo de errores → respuesta del asistente

| Código | Qué dice el asistente | ¿Handoff? |
|---|---|---|
| `INSUFFICIENT_STOCK` | Informa la cantidad realmente disponible y ofrece ajustar | No |
| `PRODUCT_INACTIVE` | Indica que ese producto no está disponible y muestra alternativas del catálogo | No |
| `OTP_INVALID` / `OTP_EXPIRED` | Pide reintentar o reenviar el código | No |
| `OTP_MAX_ATTEMPTS` | Informa que debe continuar con la asesora | **Sí** |
| `OTP_COOLDOWN` | Pide esperar antes de solicitar otro código | No |
| `SESSION_NOT_VERIFIED` | Vuelve al paso de verificación | No |
| `CONSENT_REQUIRED` | Repite la solicitud de autorización de datos | No |
| `EMPTY_CART` | Invita a elegir productos | No |
| `ORDER_ALREADY_PAID` | Explica que los cambios sobre un pedido pagado los gestiona la asesora | **Sí** |
| `ALREADY_EXTENDED` | Informa que el plazo ya fue extendido una vez | No |
| `ORDER_NOT_FOUND` | Indica que no encuentra ese pedido a su nombre | No |
| `AI_PROVIDER_DOWN` / `ERROR_TECNICO` | Mensaje neutro de disculpa | **Sí** (automático) |
| `RATE_LIMITED` | Pide esperar un momento | No |
