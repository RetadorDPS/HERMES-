export const metadata = { title: 'Política de privacidad' };

/**
 * PLANTILLA. Rellena los campos entre corchetes y revísala con asesoría legal
 * antes de publicar: eres el responsable del tratamiento de los datos de tus
 * clientes y de los de sus compradores.
 */
export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Política de privacidad</h1>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[12.5px] text-amber-100">
        Plantilla pendiente de revisión legal. Sustituye los textos entre corchetes por los datos reales de tu empresa
        antes de ofrecer el servicio a terceros.
      </div>

      <h2 className="text-[14px] font-semibold text-foreground">1. Responsable del tratamiento</h2>
      <p>
        [RAZÓN SOCIAL], con NIF [NIF] y domicilio en [DIRECCIÓN], es el responsable del tratamiento de los datos
        personales recogidos a través de este servicio. Correo de contacto: [EMAIL DE PRIVACIDAD].
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">2. Datos que tratamos</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Datos de la cuenta: nombre, correo electrónico, contraseña cifrada, dirección IP y fechas de acceso.</li>
        <li>Datos de facturación: plan contratado, importes e identificadores de pago (gestionados por Stripe).</li>
        <li>Datos de tus tiendas y proveedores: credenciales de API, cifradas con AES-256-GCM.</li>
        <li>Datos de pedidos de tus compradores: los necesarios para tramitar el pedido con el proveedor.</li>
        <li>Registros de actividad y errores, para seguridad y soporte.</li>
      </ul>

      <h2 className="text-[14px] font-semibold text-foreground">3. Finalidad y base jurídica</h2>
      <p>
        Prestación del servicio contratado (ejecución de contrato), facturación (obligación legal), seguridad y
        prevención del fraude (interés legítimo) y comunicaciones operativas. No se toman decisiones automatizadas
        con efectos jurídicos sobre las personas.
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">4. Destinatarios y encargados</h2>
      <p>
        Colaboran con nosotros: [PROVEEDOR DE HOSTING] (alojamiento), Stripe Payments Europe (pagos), [PROVEEDOR DE
        CORREO] (envío de correos transaccionales) y las plataformas de tienda y proveedores que TÚ conectes. La
        relación se formaliza con los contratos de encargado correspondientes.
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">5. Conservación</h2>
      <p>
        Mientras la cuenta esté activa y, tras su cancelación, durante [PLAZO] para atender responsabilidades
        legales. Los registros de seguridad se conservan [PLAZO].
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">6. Tus derechos</h2>
      <p>
        Puedes ejercer acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a [EMAIL DE
        PRIVACIDAD], y reclamar ante la Agencia Española de Protección de Datos (www.aepd.es). Si eres cliente nuestro
        y actúas como responsable de los datos de tus compradores, atenderemos tus solicitudes como encargado.
      </p>
    </>
  );
}
