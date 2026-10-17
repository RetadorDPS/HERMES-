-- ============================================================================
-- Hermes (DropshipPilot) — Seguridad
--
-- Principios:
--   1. Nadie sin sesión ve nada (el rol «anon» no tiene acceso a ninguna tabla).
--   2. Cada cliente solo ve y toca SUS filas (reglas de seguridad por fila, RLS).
--   3. Las claves y secretos (columnas «...Enc», contraseñas, tokens) NUNCA se
--      pueden leer desde el navegador: solo las funciones del servidor
--      (clave «service_role») las usan.
--   4. El cliente no puede cambiarse a sí mismo el rol ni el plan.
-- ============================================================================

-- ── Funciones de ayuda (se ejecutan con permisos del dueño, sin saltarse la lógica) ──
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."User" u
    WHERE u."id" = auth.uid()::text AND u."role" = 'ADMIN'
  );
$$;

CREATE OR REPLACE FUNCTION public.es_mi_producto(p_producto text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."Product" p
    WHERE p."id" = p_producto AND p."userId" = auth.uid()::text
  );
$$;

CREATE OR REPLACE FUNCTION public.es_mi_pedido(p_pedido text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."Order" o
    WHERE o."id" = p_pedido AND o."userId" = auth.uid()::text
  );
$$;

REVOKE ALL ON FUNCTION public.es_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.es_mi_producto(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.es_mi_pedido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.es_mi_producto(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.es_mi_pedido(text) TO authenticated;

-- ── Alta automática: al crearse una cuenta en el acceso de Supabase, se crea su ficha y su prueba ──
CREATE OR REPLACE FUNCTION public.crear_ficha_de_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public."User" ("id", "email", "name")
  VALUES (NEW.id::text, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.raw_user_meta_data ->> 'full_name'))
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO public."Subscription" ("userId") VALUES (NEW.id::text);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crear_ficha_de_usuario() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER "crear_ficha_de_usuario_al_registrarse"
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.crear_ficha_de_usuario();

-- ── 1) Activar RLS y quitar todos los permisos por defecto ──

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PricingRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Store" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProductVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProductImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProductReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SyncLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SyncJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ShippingQuote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SupplierAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PlatformCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CatalogCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CatalogItem" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."User" FROM anon, authenticated;
REVOKE ALL ON public."Subscription" FROM anon, authenticated;
REVOKE ALL ON public."PricingRule" FROM anon, authenticated;
REVOKE ALL ON public."Supplier" FROM anon, authenticated;
REVOKE ALL ON public."Store" FROM anon, authenticated;
REVOKE ALL ON public."Product" FROM anon, authenticated;
REVOKE ALL ON public."ProductVariant" FROM anon, authenticated;
REVOKE ALL ON public."ProductImage" FROM anon, authenticated;
REVOKE ALL ON public."ProductReview" FROM anon, authenticated;
REVOKE ALL ON public."Order" FROM anon, authenticated;
REVOKE ALL ON public."OrderItem" FROM anon, authenticated;
REVOKE ALL ON public."SyncLog" FROM anon, authenticated;
REVOKE ALL ON public."SyncJob" FROM anon, authenticated;
REVOKE ALL ON public."WebhookEvent" FROM anon, authenticated;
REVOKE ALL ON public."ShippingQuote" FROM anon, authenticated;
REVOKE ALL ON public."VerificationToken" FROM anon, authenticated;
REVOKE ALL ON public."SupplierAccount" FROM anon, authenticated;
REVOKE ALL ON public."AuditLog" FROM anon, authenticated;
REVOKE ALL ON public."PlatformCredential" FROM anon, authenticated;
REVOKE ALL ON public."CatalogCategory" FROM anon, authenticated;
REVOKE ALL ON public."CatalogItem" FROM anon, authenticated;

-- ── 2) Permisos mínimos por tabla (lo que cada columna permite) y reglas por fila ──

-- User: cada cliente ve su ficha (sin datos sensibles) y edita solo sus preferencias
GRANT SELECT ("id", "email", "name", "image", "role", "plan", "timezone", "lastLoginAt", "emailVerifiedAt", "tourVersion", "tourSeenAt", "adminTourVersion", "adminTourSeenAt", "onboardingHiddenAt", "onboardingNudgedAt", "totpEnabledAt", "alertSyncFailures", "alertStockChanges", "alertWebhookErrors", "alertBilling", "alertOnboarding", "createdAt", "updatedAt") ON public."User" TO authenticated;
GRANT UPDATE ("name", "image", "timezone", "tourVersion", "tourSeenAt", "adminTourVersion", "adminTourSeenAt", "onboardingHiddenAt", "onboardingNudgedAt", "alertSyncFailures", "alertStockChanges", "alertWebhookErrors", "alertBilling", "alertOnboarding") ON public."User" TO authenticated;
CREATE POLICY "usuario_ve_su_ficha" ON public."User" FOR SELECT TO authenticated USING ("id" = auth.uid()::text OR public.es_admin());
CREATE POLICY "usuario_edita_su_ficha" ON public."User" FOR UPDATE TO authenticated USING ("id" = auth.uid()::text) WITH CHECK ("id" = auth.uid()::text);

-- Subscription: solo lectura (los cambios de plan los hace el servidor)
GRANT SELECT ON public."Subscription" TO authenticated;
CREATE POLICY "suscripcion_propia" ON public."Subscription" FOR SELECT TO authenticated USING ("userId" = auth.uid()::text OR public.es_admin());

-- PricingRule: reglas de margen propias, control total
GRANT SELECT, INSERT, UPDATE, DELETE ON public."PricingRule" TO authenticated;
CREATE POLICY "reglas_ver_propias" ON public."PricingRule" FOR SELECT TO authenticated USING ("userId" = auth.uid()::text);
CREATE POLICY "reglas_borrar_propias" ON public."PricingRule" FOR DELETE TO authenticated USING ("userId" = auth.uid()::text);
CREATE POLICY "reglas_crear_propias" ON public."PricingRule" FOR INSERT TO authenticated WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "reglas_editar_propias" ON public."PricingRule" FOR UPDATE TO authenticated USING ("userId" = auth.uid()::text) WITH CHECK ("userId" = auth.uid()::text);

-- Supplier: lista global de proveedores, sin claves
GRANT SELECT ("id", "type", "name", "baseUrl", "logoUrl", "isEnabled", "rateLimitRpm", "createdAt", "updatedAt") ON public."Supplier" TO authenticated;
CREATE POLICY "proveedores_visibles" ON public."Supplier" FOR SELECT TO authenticated USING (true);

-- Store: tiendas propias (sin tokens); alta y cambio de claves solo desde el servidor
GRANT SELECT ("id", "userId", "platform", "name", "domain", "apiVersion", "scopes", "status", "lastPingAt", "lastError", "settings", "createdAt", "updatedAt") ON public."Store" TO authenticated;
GRANT UPDATE ("name", "settings") ON public."Store" TO authenticated;
GRANT DELETE ON public."Store" TO authenticated;
CREATE POLICY "tiendas_ver_propias" ON public."Store" FOR SELECT TO authenticated USING ("userId" = auth.uid()::text);
CREATE POLICY "tiendas_editar_propias" ON public."Store" FOR UPDATE TO authenticated USING ("userId" = auth.uid()::text) WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "tiendas_borrar_propias" ON public."Store" FOR DELETE TO authenticated USING ("userId" = auth.uid()::text);

-- Product: productos propios; el alta (importar) la hace el servidor
GRANT SELECT, UPDATE, DELETE ON public."Product" TO authenticated;
CREATE POLICY "productos_ver_propios" ON public."Product" FOR SELECT TO authenticated USING ("userId" = auth.uid()::text);
CREATE POLICY "productos_editar_propios" ON public."Product" FOR UPDATE TO authenticated USING ("userId" = auth.uid()::text) WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "productos_borrar_propios" ON public."Product" FOR DELETE TO authenticated USING ("userId" = auth.uid()::text);

-- ProductVariant: heredan el dueño del producto
GRANT SELECT, UPDATE, DELETE ON public."ProductVariant" TO authenticated;
CREATE POLICY "productvariant_ver" ON public."ProductVariant" FOR SELECT TO authenticated USING (public.es_mi_producto("productId"));
CREATE POLICY "productvariant_editar" ON public."ProductVariant" FOR UPDATE TO authenticated USING (public.es_mi_producto("productId")) WITH CHECK (public.es_mi_producto("productId"));
CREATE POLICY "productvariant_borrar" ON public."ProductVariant" FOR DELETE TO authenticated USING (public.es_mi_producto("productId"));

-- ProductImage: heredan el dueño del producto
GRANT SELECT, UPDATE, DELETE ON public."ProductImage" TO authenticated;
CREATE POLICY "productimage_ver" ON public."ProductImage" FOR SELECT TO authenticated USING (public.es_mi_producto("productId"));
CREATE POLICY "productimage_editar" ON public."ProductImage" FOR UPDATE TO authenticated USING (public.es_mi_producto("productId")) WITH CHECK (public.es_mi_producto("productId"));
CREATE POLICY "productimage_borrar" ON public."ProductImage" FOR DELETE TO authenticated USING (public.es_mi_producto("productId"));

-- ProductReview: heredan el dueño del producto
GRANT SELECT, UPDATE, DELETE ON public."ProductReview" TO authenticated;
CREATE POLICY "productreview_ver" ON public."ProductReview" FOR SELECT TO authenticated USING (public.es_mi_producto("productId"));
CREATE POLICY "productreview_editar" ON public."ProductReview" FOR UPDATE TO authenticated USING (public.es_mi_producto("productId")) WITH CHECK (public.es_mi_producto("productId"));
CREATE POLICY "productreview_borrar" ON public."ProductReview" FOR DELETE TO authenticated USING (public.es_mi_producto("productId"));

-- Order: pedidos propios, solo lectura (las acciones las hace el servidor)
GRANT SELECT ON public."Order" TO authenticated;
CREATE POLICY "pedidos_ver_propios" ON public."Order" FOR SELECT TO authenticated USING ("userId" = auth.uid()::text OR public.es_admin());

-- OrderItem: heredan el dueño del pedido
GRANT SELECT ON public."OrderItem" TO authenticated;
CREATE POLICY "lineas_ver" ON public."OrderItem" FOR SELECT TO authenticated USING (public.es_mi_pedido("orderId"));

-- SyncLog: registro propio, solo lectura
GRANT SELECT ON public."SyncLog" TO authenticated;
CREATE POLICY "registro_sync_propio" ON public."SyncLog" FOR SELECT TO authenticated USING ("userId" = auth.uid()::text OR public.es_admin());

-- SyncJob: tareas de sus productos, solo lectura
GRANT SELECT ON public."SyncJob" TO authenticated;
CREATE POLICY "tareas_ver" ON public."SyncJob" FOR SELECT TO authenticated USING ("productId" IS NOT NULL AND public.es_mi_producto("productId"));

-- SupplierAccount: cuentas propias de proveedor (sin credenciales); alta solo desde el servidor
GRANT SELECT ("id", "userId", "supplierId", "provider", "label", "status", "isDefault", "lastTestAt", "lastError", "settings", "createdAt", "updatedAt") ON public."SupplierAccount" TO authenticated;
GRANT DELETE ON public."SupplierAccount" TO authenticated;
CREATE POLICY "cuentas_proveedor_ver" ON public."SupplierAccount" FOR SELECT TO authenticated USING ("userId" = auth.uid()::text);
CREATE POLICY "cuentas_proveedor_borrar" ON public."SupplierAccount" FOR DELETE TO authenticated USING ("userId" = auth.uid()::text);

-- AuditLog: cada cliente ve lo suyo; el operador ve todo; nadie escribe desde el navegador
GRANT SELECT ON public."AuditLog" TO authenticated;
CREATE POLICY "auditoria_ver" ON public."AuditLog" FOR SELECT TO authenticated USING ("userId" = auth.uid()::text OR public.es_admin());

-- CatalogCategory y CatalogItem: catálogo común, solo lectura (sin la carga original del proveedor)
GRANT SELECT ON public."CatalogCategory" TO authenticated;
GRANT SELECT ("id", "provider", "externalId", "title", "description", "categoryId", "categoryName", "imageUrl", "images", "currency", "costPrice", "suggestedPrice", "stock", "rating", "ordersCount", "shippingCost", "shippingMinDays", "shippingMaxDays", "shipFrom", "freeShipping", "isTrending", "tags", "sourceUrl", "source", "lastSyncedAt", "refreshDueAt", "views", "importedCount", "createdAt", "updatedAt") ON public."CatalogItem" TO authenticated;
CREATE POLICY "categorias_visibles" ON public."CatalogCategory" FOR SELECT TO authenticated USING (true);
CREATE POLICY "catalogo_visible" ON public."CatalogItem" FOR SELECT TO authenticated USING (true);

-- ── 3) Sin permisos desde el navegador (solo el servidor, con «service_role») ──
--   VerificationToken, WebhookEvent, ShippingQuote, PlatformCredential
-- Con RLS activado y sin reglas ni permisos, el navegador no puede ni verlas.

