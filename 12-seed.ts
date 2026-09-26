/**
 * ============================================================================
 *  Asistente IA de Pedidos — seeds de desarrollo
 *  Ubicación en el repo: backend/prisma/seed.ts
 *
 *  Registrar en package.json:
 *    "prisma": { "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts" }
 *
 *  Ejecutar:  npx prisma db seed
 * ============================================================================
 */

import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// ─────────────────────── Catálogo de ejemplo (40 productos) ───────────────────────
// Descripciones deliberadamente simples: el asistente no da información de uso,
// dosis ni beneficios de salud, así que el catálogo tampoco la contiene.
const PRODUCTOS = Array.from({ length: 40 }, (_, i) => {
  const n = i + 1;
  return {
    sku: `SKU-${String(n).padStart(3, '0')}`,
    name: `Producto ${n}`,
    description: `Presentación estándar del producto ${n}`,
    price: 25000 + (n % 8) * 5000, // COP, sin decimales
    stockOnHand: 10 + (n % 15),
  };
});

async function main() {
  const businessName = process.env.SEED_BUSINESS_NAME ?? 'Mi Emprendimiento';
  const advisorName = process.env.SEED_ADVISOR_NAME ?? 'Asesora de Ventas';
  const superEmail = process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@local.test';
  const superPass = process.env.SEED_SUPERADMIN_PASSWORD ?? 'CambiaEstaClave123!';

  console.log('▶ Sembrando negocio demo…');

  const business = await prisma.business.upsert({
    where: { id: 'seed-business' },
    update: {},
    create: {
      id: 'seed-business',
      name: businessName,
      advisorName,
      contactPhone: '3000000000',
      timezone: 'America/Bogota',
      currency: 'COP',
    },
  });

  // Secuencia de numeración de órdenes (PED-000001)
  await prisma.orderSequence.upsert({
    where: { businessId: business.id },
    update: {},
    create: { businessId: business.id, lastNumber: 0 },
  });

  console.log('▶ Sembrando usuarios (un rol por usuario, sin mezcla)…');

  const passwordHash = await argon2.hash(superPass);

  const usuarios: Array<{ email: string; name: string; role: Role }> = [
    { email: superEmail, name: 'Super Admin', role: Role.SUPER_ADMIN },
    { email: 'admin@local.test', name: 'Admin del Negocio', role: Role.ADMIN_NEGOCIO },
    { email: 'asesor@local.test', name: advisorName, role: Role.ASESOR_VENTAS },
  ];

  for (const u of usuarios) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        businessId: business.id,
        name: u.name,
        email: u.email,
        passwordHash,
        role: u.role,
        // 2FA se configura en el primer login desde el panel (genera el QR)
        twoFactorEnabled: false,
      },
    });
  }

  console.log(`▶ Sembrando ${PRODUCTOS.length} productos…`);

  for (const p of PRODUCTOS) {
    await prisma.product.upsert({
      where: { businessId_sku: { businessId: business.id, sku: p.sku } },
      update: {},
      create: {
        businessId: business.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        price: p.price,
        stockOnHand: p.stockOnHand,
        stockReserved: 0,
        active: true,
      },
    });
  }

  console.log('▶ Sembrando cliente de prueba…');

  await prisma.customer.upsert({
    where: { businessId_phone: { businessId: business.id, phone: '3001234567' } },
    update: {},
    create: {
      businessId: business.id,
      phone: '3001234567',
      name: 'Cliente de Prueba',
      address: 'Calle 1 # 2-3, Bogotá',
      dataConsent: true,
      consentAt: new Date(),
      consentVersion: 'v1.0',
    },
  });

  console.log('\n✅ Seeds completados');
  console.log(`   Negocio : ${business.name}`);
  console.log(`   Login   : ${superEmail} / ${superPass}`);
  console.log(`   Admin   : admin@local.test / ${superPass}`);
  console.log(`   Asesor  : asesor@local.test / ${superPass}`);
  console.log('   ⚠  Cambia estas credenciales antes de cualquier despliegue.\n');
}

main()
  .catch((e) => {
    console.error('❌ Error en seeds:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
