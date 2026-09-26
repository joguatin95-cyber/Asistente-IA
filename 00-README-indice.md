# Asistente IA de Pedidos — Paquete de arranque
### Índice de documentos, v2 (17 de septiembre de 2026)

---

## Qué contiene este paquete

| # | Archivo | Para qué sirve | Quién lo usa |
|---|---|---|---|
| 01 | `01-blueprint-tecnologico-arquitectura.md` | Arquitectura completa: stack, capas, IA, seguridad, caching, observabilidad, testing | Todo el equipo |
| 02 | `02-prompt-maestro-asistente-ia.md` | System prompt del asistente + suite anti-inyección | Quien implemente el motor de IA |
| 03 | `03-resumen-ejecutivo-mvp.md` | Sustentación de viabilidad, alcance del MVP, costos, riesgos | Presentación del proyecto |
| 04 | `04-roadmap-5-fases.md` | Plan de 8 semanas con fechas, entregables y criterios de aceptación | Todo el equipo |
| 05 | `05-guia-paso-a-paso-construccion.md` | Qué construir cada semana, en qué orden | Quien programe |
| 06 | `06-schema.prisma` | Schema de base de datos ejecutable | Backend |
| 07 | `07-env.example` | Todas las variables de entorno | Backend + DevOps |
| 08 | `08-contrato-tools-ia.md` | JSON Schema de las 13 tools + catálogo de errores | Backend + IA |
| 09 | `09-estados-roles-y-reglas-inventario.md` | Máquina de estados, matriz de permisos, concurrencia de inventario | Backend + Frontend |
| 10 | `10-docker-compose.yml` | Entorno local (Postgres + Redis) | Todo el equipo |
| 11 | `11-politica-tratamiento-datos.md` | Plantilla Ley 1581 para publicar | Negocio / legal |
| 12 | `12-seed.ts` | Datos de prueba: negocio, 3 usuarios, 40 productos | Backend |

---

## Dónde va cada archivo en el repositorio

```
proyecto/
├── docker-compose.yml              ← archivo 10
├── docker/init-shadow-db.sql       ← ver comentario al final del archivo 10
├── docs/
│   ├── blueprint.md                ← archivo 01
│   ├── prompt-maestro.md           ← archivo 02
│   ├── contrato-tools.md           ← archivo 08
│   ├── estados-y-roles.md          ← archivo 09
│   └── politica-datos.md           ← archivo 11
├── backend/
│   ├── .env.example                ← archivo 07
│   ├── .env                        ← copia del anterior con secretos reales (NO commitear)
│   └── prisma/
│       ├── schema.prisma           ← archivo 06
│       └── seed.ts                 ← archivo 12
└── frontend/
    └── .env.local                  ← variables NEXT_PUBLIC_* del archivo 07
```

---

## Arranque en cinco comandos

```bash
docker compose up -d
cd backend && cp .env.example .env     # y completar los secretos
npx prisma migrate dev --name init
npx prisma db seed
npm run start:dev
```

---

## Decisiones de negocio ya fijadas (no reabrir sin actualizar los documentos)

1. **Plazo de pago:** el mismo día del pedido (hasta las 23:59:59 en `America/Bogota`). Extensible
   **un solo día**, **una sola vez**, y **solo si el cliente lo pide**.
2. **Pedido ya pagado que cambia:** lo edita el asesor en sitio, con ajuste de inventario por
   delta. Si hay excedente, se genera una orden nueva tipo `AMENDMENT` enlazada a la original.
3. **Estados:** `PENDING_REVIEW` y `PENDING_PAYMENT` fusionados en `PENDING_PAYMENT` — el asesor
   revisa y confirma el pago en un solo paso.
4. **Notificaciones:** exclusivamente dentro del chat. El único SMS del sistema es el OTP.
5. **OTP:** al inicio de la sesión, antes de exponer cualquier dato de cliente.
6. **Modelo de IA:** `claude-haiku-4-5` como base, conmutable a `claude-sonnet-5` por variable de
   entorno si hiciera falta, sin cambios de código.

---

## Lo que no debe recortarse bajo ninguna circunstancia

- Test de concurrencia de reservas de inventario
- Suite anti-inyección de prompt (20 casos)
- 2FA para los tres roles internos
- Job de liberación de pedidos no pagados
- Validación de rol **y** `businessId` en cada endpoint

Son los cinco puntos donde una falla es visible, costosa y difícil de explicar.
