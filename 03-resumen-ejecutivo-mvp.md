# Resumen Ejecutivo y MVP
### v2 · Asistente IA de Pedidos — viabilidad en 8 semanas

---

## 1. Problema

Los pequeños emprendedores que revenden productos como segundo ingreso gestionan sus pedidos
manualmente por mensajería: escriben cada respuesta, calculan totales a mano, pierden el control
del inventario y confunden pedidos pagados con no pagados. Eso limita cuántos clientes pueden
atender a la vez y genera errores costosos: vender algo sin stock, olvidar liberar un pedido no
pagado, o perder el hilo de una conversación mientras están en su otro trabajo.

## 2. Propuesta de valor

Un **asistente de IA conversacional** dentro de una aplicación web propia (no WhatsApp) que:

- Atiende al cliente, muestra el catálogo real y arma el pedido conversando de forma natural.
- Verifica identidad del cliente por código SMS **antes** de exponer cualquier dato personal.
- Verifica stock en tiempo real antes de ofrecer o confirmar cualquier producto.
- Entrega a la asesora un pedido armado y confirmado, listo solo para verificar el pago y
  despachar: la asesora deja de "tomar" pedidos y pasa a solo cerrarlos.
- Libera automáticamente el inventario de los pedidos que no se pagan el mismo día, evitando que
  el stock quede atrapado por pedidos fantasma.
- Mantiene al cliente informado de cada paso (pago confirmado, alistamiento, envío, entrega)
  dentro del mismo chat, sin costo adicional de mensajería.

## 3. Público objetivo

Pequeños emprendedores y revendedores con catálogo acotado (decenas de productos), que buscan un
segundo ingreso y necesitan una herramienta simple, de bajo costo y operable sin conocimientos
técnicos. El caso guía del proyecto es una comerciante que revende suplementos (~40 productos)
mientras tiene otro empleo.

## 4. Alcance del MVP

**Incluido:**
- Chat web con el asistente IA (Tool Use nativo de Claude, sin RAG, sin MCP).
- Verificación de identidad por OTP SMS al inicio de cada sesión.
- Catálogo e inventario administrables con carga y edición simple de stock.
- Armado de carrito con validación de disponibilidad en tiempo real y sin doble ingreso.
- Generación de orden de venta con número legible y plazo de pago del mismo día.
- Extensión de plazo de un día, solo a solicitud del cliente y una sola vez.
- Bandeja del asesor: revisar, confirmar pago, liberar, editar orden pagada, actualizar envío.
- Liberación automática y manual de pedidos no pagados con devolución de inventario.
- Edición en sitio de órdenes pagadas, con orden de excedente enlazada cuando aplique.
- Panel de administración con tres roles estrictamente separados.
- Registro de clientes con consentimiento de datos (Ley 1581) y derechos ARCO.
- Notificación al cliente en cada cambio de estado, dentro del chat.
- Observabilidad (logs, errores, métricas de negocio) y testing automatizado del flujo crítico,
  incluida una suite anti-inyección de prompt.

**Fuera del MVP (fases posteriores):** pasarelas de pago automatizadas, tracking con
transportadoras, analítica avanzada de ventas, multi-idioma, app móvil nativa.

## 5. Por qué es viable en 8 semanas

- **Sin RAG ni infraestructura vectorial:** el catálogo es pequeño y estructurado; la consulta es
  directa a Postgres. Se ahorran semanas de pipelines de embeddings.
- **Sin MCP:** Tool Use nativo con un `ToolRegistry` propio reduce la superficie de integración.
- **Contratos escritos antes de programar:** schema Prisma, JSON Schema de las 13 tools, máquina
  de estados y matriz de permisos ya están definidos, lo que elimina la mayor fuente de retrabajo.
- **Stack de alta productividad y capas gratuitas:** NestJS, Prisma y Next.js, sobre Vercel,
  Railway/Render, Supabase/Neon y Upstash.
- **Alcance acotado:** un negocio piloto y ~40 productos; ampliar el catálogo no requiere cambios
  de arquitectura, solo carga de datos.

## 6. Costos estimados

| Componente | Proveedor | Costo en el MVP |
|---|---|---|
| Frontend | Vercel (free tier) | $0 |
| Backend | Railway / Render (hobby) | $0–5 USD/mes |
| Base de datos | Supabase / Neon (free tier) | $0 |
| Redis | Upstash (free tier) | $0 |
| Observabilidad | Sentry + Grafana Cloud (free tier) | $0 |
| SMS (solo OTP) | Twilio / Infobip | Pago por uso, 1 SMS por sesión de cliente |
| IA | Anthropic, modelo `claude-haiku-4-5` | $1 por millón de tokens de entrada, $5 de salida |

Elegir Haiku 4.5 en lugar de Sonnet 5 reduce el costo de IA a aproximadamente un tercio, sin
cambios de código: es la misma API y el mismo formato de tool use, conmutable por variable de
entorno. Además, las notificaciones de estado viajan por el chat y no por SMS, de modo que el
único mensaje de texto del sistema es el código de verificación.

El costo variable crece solo cuando el negocio efectivamente vende más.

## 7. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Alucinación de precio o stock | Verdad exclusivamente en backend; el frontend renderiza las cifras desde el resultado de la tool, no desde el texto del modelo |
| Inyección de prompt por parte de clientes | Cláusula anti-inyección + refuerzo estructural: ninguna tool acepta precios o descuentos; `PAID` no está expuesto como tool; suite de 20 casos de prueba |
| Sobreventa por concurrencia | Reserva con update condicional atómico (`WHERE stockOnHand - stockReserved >= qty`) y test de concurrencia obligatorio |
| Fuga de datos entre clientes | Sesión de invitado + OTP obligatorio antes de exponer cualquier dato de cliente existente |
| Doble ingreso de producto | Semántica SET en `set_cart_item` + restricción única `(cartId, productId)` |
| Liberación de pedidos a la hora equivocada | Cálculo del corte del día en `America/Bogota` con Luxon, almacenado en UTC |
| Costo de IA fuera de control | Modelo económico + prompt caching + límite diario por negocio con alerta |
| Curva de aprendizaje del stack | Frameworks de alta productividad y documentación amplia; contratos definidos antes de codificar |

## 8. Cronograma resumen

| Fase | Contenido | Duración |
|---|---|---|
| 1 | Fundamentos, arquitectura, schema, entornos, CI/CD | 2 semanas |
| 2 | Backend core: inventario, carrito, órdenes, roles, 2FA | 2 semanas |
| 3 | Motor de IA: tools, prompt maestro, anti-alucinación e inyección | 1 semana |
| 4 | Frontend: chat cliente, panel admin, panel asesor | 2 semanas |
| 5 | Testing, observabilidad, despliegue y entrega | 1 semana |

Fechas detalladas en el archivo 04 (roadmap).

## 9. Conclusión de viabilidad

El proyecto es técnicamente viable en ocho semanas porque el alcance está acotado, se evita
deliberadamente infraestructura pesada innecesaria, el stack prioriza productividad y capas
gratuitas, y los contratos críticos (datos, herramientas, estados, permisos) quedaron definidos
antes de escribir la primera línea de código. El resultado es un MVP funcional, seguro (2FA, OTP,
anti-inyección, aislamiento multi-tenant) y de costo operativo bajo, apto para un emprendimiento
pequeño real.
