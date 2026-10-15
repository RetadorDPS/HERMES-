export const metadata = { title: 'Términos y condiciones' };

/** PLANTILLA. Rellena y revisa con asesoría legal antes de publicar. */
export default function TermsPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Términos y condiciones del servicio</h1>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[12.5px] text-amber-100">
        Plantilla pendiente de revisión legal. Ajusta planes, precios, plazos y límites de responsabilidad a tu
        negocio real.
      </div>

      <h2 className="text-[14px] font-semibold text-foreground">1. Objeto</h2>
      <p>
        [RAZÓN SOCIAL] presta un servicio de software (SaaS) de automatización de dropshipping: extracción de datos de
        productos de proveedores, sincronización de catálogo, precios y stock con tiendas, y tramitación de pedidos a
        proveedores.
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">2. Cuenta y seguridad</h2>
      <p>
        Debes aportar datos veraces, custodiar tus credenciales y activar el segundo factor. Eres responsable del uso
        que se haga de tu cuenta y de las credenciales de tiendas y proveedores que conectes.
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">3. Planes, precios y pagos</h2>
      <p>
        Los planes y precios vigentes se muestran en la sección de facturación. La suscripción se renueva
        automáticamente salvo cancelación antes de la fecha de renovación. Los planes incluyen límites de uso
        (productos, tiendas, cuentas de proveedor y créditos mensuales) que puedes consultar en el panel. Los
        créditos no consumidos no se acumulan de un mes a otro.
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">4. Uso aceptable</h2>
      <p>
        Te comprometes a cumplir las condiciones de uso de las plataformas de terceros (tiendas y proveedores) y la
        normativa aplicable a tu actividad, incluida la de comercio electrónico, consumo y publicidad. No está
        permitido usar el servicio para actividades ilícitas, productos prohibidos o para vulnerar derechos de
        terceros.
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">5. Datos de terceros y responsabilidad</h2>
      <p>
        La extracción de datos de sitios de proveedores puede verse afectada por cambios en esos sitios o por medidas
        anti-bot; haremos lo razonable para mantenerla, sin garantizar resultados concretos. El servicio se presta
        «tal cual», con los límites de responsabilidad previstos en la ley ([LÍMITE]). No respondemos de lucro cesante
        ni de daños indirectos.
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">6. Suspensión y cancelación</h2>
      <p>
        Puedes cancelar en cualquier momento desde el panel; mantendrás el acceso hasta el final del periodo pagado.
        Podemos suspender el servicio por impago o por uso que vulnere estos términos, avisando cuando sea posible.
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">7. Ley aplicable</h2>
      <p>Estos términos se rigen por la legislación española, con los juzgados de [CIUDAD] como fuero.</p>
    </>
  );
}
