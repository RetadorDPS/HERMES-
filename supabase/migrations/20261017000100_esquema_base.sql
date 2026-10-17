-- ============================================================================
-- Hermes (DropshipPilot) — Esquema base
-- Generado a partir de prisma/schema.prisma (21 tablas) y ajustado para Supabase:
--   • los identificadores ("id") los crea la base de datos (antes los creaba Prisma)
--   • "updatedAt" se rellena solo al crear y se actualiza solo al modificar
-- La seguridad (quién ve qué) va en la migración siguiente.
-- ============================================================================

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('TRIAL', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('ALIEXPRESS', 'CJ_DROPSHIPPING', 'AMAZON', 'ALIBABA', 'TEMU', 'OTHER');

-- CreateEnum
CREATE TYPE "StorePlatform" AS ENUM ('SHOPIFY', 'WOOCOMMERCE');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'OUT_OF_STOCK', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('IMPORT', 'PRICE_UPDATE', 'STOCK_UPDATE', 'FULL_REFRESH', 'ORDER_PUSH', 'DELETE');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'SUPPLIER_PURCHASED', 'SUPPLIER_ERROR', 'SHIPPED', 'DELIVERED', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('UNFULFILLED', 'PARTIAL', 'FULFILLED', 'RESTOCKED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'DEBUG');

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'EMAIL_CHANGE');

-- CreateEnum
CREATE TYPE "SupplierAccountStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISABLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "plan" "PlanTier" NOT NULL DEFAULT 'TRIAL',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "lastLoginAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "signupIp" TEXT,
    "lastIp" TEXT,
    "tourVersion" INTEGER NOT NULL DEFAULT 0,
    "tourSeenAt" TIMESTAMP(3),
    "adminTourVersion" INTEGER NOT NULL DEFAULT 0,
    "adminTourSeenAt" TIMESTAMP(3),
    "onboardingHiddenAt" TIMESTAMP(3),
    "onboardingNudgedAt" TIMESTAMP(3),
    "totpSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpRecoveryCodes" TEXT[],
    "alertSyncFailures" BOOLEAN NOT NULL DEFAULT true,
    "alertStockChanges" BOOLEAN NOT NULL DEFAULT true,
    "alertWebhookErrors" BOOLEAN NOT NULL DEFAULT true,
    "alertBilling" BOOLEAN NOT NULL DEFAULT true,
    "alertOnboarding" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "lemonCustomerId" TEXT,
    "lemonSubscriptionId" TEXT,
    "lemonVariantId" TEXT,
    "lemonStatus" TEXT,
    "plan" "PlanTier" NOT NULL DEFAULT 'TRIAL',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "creditsLimit" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "markupPct" DECIMAL(6,2) NOT NULL DEFAULT 40,
    "fixedFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "minProfit" DECIMAL(10,2) NOT NULL DEFAULT 1.5,
    "minPrice" DECIMAL(10,2),
    "maxPrice" DECIMAL(10,2),
    "roundTo" DECIMAL(4,2) DEFAULT 0.99,
    "includeShipping" BOOLEAN NOT NULL DEFAULT true,
    "applyToCategory" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "type" "SupplierType" NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyEnc" TEXT,
    "apiSecretEnc" TEXT,
    "scraperConfig" JSONB,
    "proxyPool" TEXT[],
    "rateLimitRpm" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "platform" "StorePlatform" NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "consumerSecretEnc" TEXT,
    "apiVersion" TEXT NOT NULL DEFAULT '2025-01',
    "scopes" TEXT[],
    "status" "StoreStatus" NOT NULL DEFAULT 'PENDING',
    "lastPingAt" TIMESTAMP(3),
    "lastError" TEXT,
    "settings" JSONB,
    "webhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "storeId" TEXT,
    "supplierId" TEXT NOT NULL,
    "pricingRuleId" TEXT,
    "supplierProductId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seoTitle" TEXT,
    "description" TEXT NOT NULL,
    "bullets" TEXT[],
    "category" TEXT,
    "categoryPath" TEXT[],
    "tags" TEXT[],
    "brand" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "costPrice" DECIMAL(10,2) NOT NULL,
    "shippingCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "compareAtPrice" DECIMAL(10,2),
    "marginPct" DECIMAL(6,2) NOT NULL DEFAULT 40,
    "profitAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stockTotal" INTEGER NOT NULL DEFAULT 0,
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "isMonitored" BOOLEAN NOT NULL DEFAULT true,
    "autoUpdatePrice" BOOLEAN NOT NULL DEFAULT true,
    "autoUpdateStock" BOOLEAN NOT NULL DEFAULT true,
    "storeProductId" TEXT,
    "storeHandle" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" "SyncStatus",
    "lastSyncError" TEXT,
    "providerHash" TEXT,
    "nextSyncAt" TIMESTAMP(3),
    "syncPriority" INTEGER NOT NULL DEFAULT 5,
    "rawPayload" JSONB,
    "shippingOptions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "productId" TEXT NOT NULL,
    "supplierVariantId" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "title" TEXT NOT NULL,
    "option1Name" TEXT,
    "option1Value" TEXT,
    "option2Name" TEXT,
    "option2Value" TEXT,
    "option3Name" TEXT,
    "option3Value" TEXT,
    "color" TEXT,
    "size" TEXT,
    "material" TEXT,
    "costPrice" DECIMAL(10,2) NOT NULL,
    "shippingCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "compareAtPrice" DECIMAL(10,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "weightGrams" INTEGER,
    "imageUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "storeVariantId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "url" TEXT NOT NULL,
    "hdUrl" TEXT,
    "alt" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReview" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "productId" TEXT NOT NULL,
    "supplierReviewId" TEXT,
    "rating" INTEGER NOT NULL,
    "author" TEXT,
    "authorCountry" TEXT,
    "text" TEXT,
    "images" TEXT[],
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "variantSku" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isImported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierAccountId" TEXT,
    "storeOrderId" TEXT NOT NULL,
    "storeOrderNumber" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillmentStatus" "FulfillmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "shippingName" TEXT,
    "shippingAddress1" TEXT,
    "shippingAddress2" TEXT,
    "shippingCity" TEXT,
    "shippingProvince" TEXT,
    "shippingCountry" TEXT,
    "shippingZip" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "shippingTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "supplierCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "profitAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "trackingNumber" TEXT,
    "trackingCompany" TEXT,
    "trackingUrl" TEXT,
    "supplierOrderId" TEXT,
    "supplierOrderStatus" TEXT,
    "autoFulfilled" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "notes" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pushedToSupplierAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "supplierVariantId" TEXT,
    "storeLineItemId" TEXT,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "imageUrl" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT,
    "storeId" TEXT,
    "supplierId" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "type" "SyncType" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "changes" JSONB,
    "beforeState" JSONB,
    "afterState" JSONB,
    "durationMs" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "jobId" TEXT,
    "errorStack" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "queue" TEXT NOT NULL DEFAULT 'sync',
    "jobName" TEXT NOT NULL,
    "jobId" TEXT,
    "productId" TEXT,
    "storeId" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "storeId" TEXT,
    "topic" TEXT NOT NULL,
    "externalId" TEXT,
    "signature" TEXT,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingQuote" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "supplierId" TEXT,
    "productId" TEXT,
    "destinationCountry" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "carrier" TEXT,
    "cost" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "minDays" INTEGER,
    "maxDays" INTEGER,
    "isTracked" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierAccount" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "supplierId" TEXT,
    "provider" "SupplierType" NOT NULL,
    "label" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "status" "SupplierAccountStatus" NOT NULL DEFAULT 'PENDING',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastTestAt" TIMESTAMP(3),
    "lastError" TEXT,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCredential" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "provider" "SupplierType" NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Plataforma',
    "credentialsEnc" TEXT NOT NULL,
    "status" "SupplierAccountStatus" NOT NULL DEFAULT 'PENDING',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTestAt" TIMESTAMP(3),
    "lastError" TEXT,
    "monthlyQuota" INTEGER,
    "usedThisMonth" INTEGER NOT NULL DEFAULT 0,
    "quotaResetAt" TIMESTAMP(3),
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCategory" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "provider" "SupplierType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentName" TEXT,
    "imageUrl" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "provider" "SupplierType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "imageUrl" TEXT,
    "images" TEXT[],
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "costPrice" DOUBLE PRECISION NOT NULL,
    "suggestedPrice" DOUBLE PRECISION,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "ordersCount" INTEGER,
    "shippingCost" DOUBLE PRECISION,
    "shippingMinDays" INTEGER,
    "shippingMaxDays" INTEGER,
    "shipFrom" TEXT,
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "isTrending" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "rawPayload" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'api',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshDueAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_lemonSubscriptionId_key" ON "Subscription"("lemonSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_stripeSubscriptionId_idx" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_lemonSubscriptionId_idx" ON "Subscription"("lemonSubscriptionId");

-- CreateIndex
CREATE INDEX "PricingRule_userId_isActive_idx" ON "PricingRule"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_type_name_key" ON "Supplier"("type", "name");

-- CreateIndex
CREATE INDEX "Store_userId_status_idx" ON "Store"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Store_userId_domain_key" ON "Store"("userId", "domain");

-- CreateIndex
CREATE INDEX "Product_userId_status_idx" ON "Product"("userId", "status");

-- CreateIndex
CREATE INDEX "Product_storeId_status_idx" ON "Product"("storeId", "status");

-- CreateIndex
CREATE INDEX "Product_supplierId_lastSyncedAt_idx" ON "Product"("supplierId", "lastSyncedAt");

-- CreateIndex
CREATE INDEX "Product_isMonitored_nextSyncAt_idx" ON "Product"("isMonitored", "nextSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_userId_sourceUrl_key" ON "Product"("userId", "sourceUrl");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");

-- CreateIndex
CREATE INDEX "ProductVariant_storeVariantId_idx" ON "ProductVariant"("storeVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_supplierVariantId_key" ON "ProductVariant"("productId", "supplierVariantId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_position_idx" ON "ProductImage"("productId", "position");

-- CreateIndex
CREATE INDEX "ProductReview_productId_rating_idx" ON "ProductReview"("productId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_productId_supplierReviewId_key" ON "ProductReview"("productId", "supplierReviewId");

-- CreateIndex
CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");

-- CreateIndex
CREATE INDEX "Order_supplierAccountId_idx" ON "Order"("supplierAccountId");

-- CreateIndex
CREATE INDEX "Order_userId_fulfillmentStatus_idx" ON "Order"("userId", "fulfillmentStatus");

-- CreateIndex
CREATE INDEX "Order_trackingNumber_idx" ON "Order"("trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_storeOrderId_key" ON "Order"("storeId", "storeOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "SyncLog_userId_createdAt_idx" ON "SyncLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncLog_productId_createdAt_idx" ON "SyncLog"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncLog_type_status_idx" ON "SyncLog"("type", "status");

-- CreateIndex
CREATE INDEX "SyncLog_storeId_status_idx" ON "SyncLog"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_jobId_key" ON "SyncJob"("jobId");

-- CreateIndex
CREATE INDEX "SyncJob_status_scheduledFor_idx" ON "SyncJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "SyncJob_queue_status_idx" ON "SyncJob"("queue", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_topic_processed_idx" ON "WebhookEvent"("topic", "processed");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_storeId_externalId_key" ON "WebhookEvent"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "ShippingQuote_productId_destinationCountry_idx" ON "ShippingQuote"("productId", "destinationCountry");

-- CreateIndex
CREATE INDEX "ShippingQuote_supplierId_destinationCountry_idx" ON "ShippingQuote"("supplierId", "destinationCountry");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_type_idx" ON "VerificationToken"("userId", "type");

-- CreateIndex
CREATE INDEX "VerificationToken_expiresAt_idx" ON "VerificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "SupplierAccount_userId_status_idx" ON "SupplierAccount"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierAccount_userId_provider_label_key" ON "SupplierAccount"("userId", "provider", "label");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCredential_provider_key" ON "PlatformCredential"("provider");

-- CreateIndex
CREATE INDEX "CatalogCategory_provider_sortOrder_idx" ON "CatalogCategory"("provider", "sortOrder");

-- CreateIndex
CREATE INDEX "CatalogCategory_slug_idx" ON "CatalogCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCategory_provider_externalId_key" ON "CatalogCategory"("provider", "externalId");

-- CreateIndex
CREATE INDEX "CatalogItem_provider_categoryId_idx" ON "CatalogItem"("provider", "categoryId");

-- CreateIndex
CREATE INDEX "CatalogItem_isTrending_idx" ON "CatalogItem"("isTrending");

-- CreateIndex
CREATE INDEX "CatalogItem_costPrice_idx" ON "CatalogItem"("costPrice");

-- CreateIndex
CREATE INDEX "CatalogItem_shipFrom_idx" ON "CatalogItem"("shipFrom");

-- CreateIndex
CREATE INDEX "CatalogItem_views_idx" ON "CatalogItem"("views");

-- CreateIndex
CREATE INDEX "CatalogItem_source_idx" ON "CatalogItem"("source");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_provider_externalId_key" ON "CatalogItem"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_supplierAccountId_fkey" FOREIGN KEY ("supplierAccountId") REFERENCES "SupplierAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAccount" ADD CONSTRAINT "SupplierAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── «updatedAt» automático ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tocar_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tocar_updated_at_User" BEFORE UPDATE ON public."User" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_Subscription" BEFORE UPDATE ON public."Subscription" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_PricingRule" BEFORE UPDATE ON public."PricingRule" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_Supplier" BEFORE UPDATE ON public."Supplier" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_Store" BEFORE UPDATE ON public."Store" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_Product" BEFORE UPDATE ON public."Product" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_ProductVariant" BEFORE UPDATE ON public."ProductVariant" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_Order" BEFORE UPDATE ON public."Order" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_SyncJob" BEFORE UPDATE ON public."SyncJob" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_SupplierAccount" BEFORE UPDATE ON public."SupplierAccount" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_PlatformCredential" BEFORE UPDATE ON public."PlatformCredential" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_CatalogCategory" BEFORE UPDATE ON public."CatalogCategory" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
CREATE TRIGGER "tocar_updated_at_CatalogItem" BEFORE UPDATE ON public."CatalogItem" FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();
