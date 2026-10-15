/**
 * POST   /api/supplier-accounts/[id]/test   → vuelve a validar contra la API real
 * PATCH  /api/supplier-accounts/[id]        → marca predeterminada / renombra / activa-desactiva
 * DELETE /api/supplier-accounts/[id]        → elimina la conexión
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiTenant, withCurrentTenant } from '@/lib/tenant';
import { clientFromAccount } from '@/lib/supplier-apis';
import { audit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return apiTenant(async (userId) => {
    const action = new URL(req.url).searchParams.get('action');

    // Revalidación de credenciales
    if (action === 'test') {
      const account = await prisma.supplierAccount.findFirst({ where: { id: params.id, userId } });
      if (!account) return NextResponse.json({ ok: false, error: 'Conexión no encontrada' }, { status: 404 });

      const client = clientFromAccount(account);
      if (!client) return NextResponse.json({ ok: false, error: 'Este proveedor no tiene API soportada' }, { status: 400 });

      const test = await client.testConnection();
      await prisma.supplierAccount.update({
        where: { id: account.id },
        data: { lastTestAt: new Date(), lastError: test.ok ? null : test.message, status: test.ok ? 'CONNECTED' : 'ERROR' },
      });
      await audit({ userId, action: 'supplier_account.tested', metadata: { provider: account.provider, ok: test.ok } });

      return NextResponse.json({ ok: true, test });
    }

    return NextResponse.json({ ok: false, error: 'Acción no reconocida' }, { status: 400 });
  });
}

const patchSchema = z.object({
  isDefault: z.boolean().optional(),
  label: z.string().min(2).max(60).optional(),
  status: z.enum(['PENDING', 'CONNECTED', 'ERROR', 'DISABLED']).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return apiTenant(async (userId) => {
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Datos no válidos' }, { status: 422 });

    const account = await prisma.supplierAccount.findFirst({ where: { id: params.id, userId } });
    if (!account) return NextResponse.json({ ok: false, error: 'Conexión no encontrada' }, { status: 404 });

    if (parsed.data.isDefault) {
      await prisma.supplierAccount.updateMany({ where: { userId, provider: account.provider, NOT: { id: account.id } }, data: { isDefault: false } });
    }

    const updated = await prisma.supplierAccount.update({
      where: { id: account.id },
      data: {
        ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
        ...(parsed.data.label ? { label: parsed.data.label } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      },
    });

    return NextResponse.json({ ok: true, account: { id: updated.id, label: updated.label, isDefault: updated.isDefault, status: updated.status } });
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return apiTenant(async (userId) => {
    const account = await prisma.supplierAccount.findFirst({ where: { id: params.id, userId } });
    if (!account) return NextResponse.json({ ok: false, error: 'Conexión no encontrada' }, { status: 404 });

    await prisma.supplierAccount.delete({ where: { id: account.id } });
    await audit({ userId, action: 'supplier_account.deleted', metadata: { provider: account.provider, label: account.label } });

    return NextResponse.json({ ok: true, deleted: account.id });
  });
}
