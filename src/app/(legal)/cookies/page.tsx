export const metadata = { title: 'Política de cookies' };

/** PLANTILLA. Si añades analítica o publicidad, esta política debe cambiar. */
export default function CookiesPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Política de cookies</h1>

      <h2 className="text-[14px] font-semibold text-foreground">1. Qué usamos</h2>
      <p>
        Este servicio utiliza únicamente <strong>cookies técnicas necesarias</strong> para su funcionamiento: mantener
        la sesión iniciada y proteger los formularios frente a ataques (token CSRF). No se utilizan cookies de
        publicidad ni de seguimiento de terceros, y por eso no se muestra un panel de consentimiento.
      </p>

      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-white/10 text-left">
            <th className="py-2">Cookie</th>
            <th className="py-2">Finalidad</th>
            <th className="py-2">Duración</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-white/[0.06]">
            <td className="py-2 font-mono">next-auth.session-token</td>
            <td className="py-2">Mantener la sesión iniciada</td>
            <td className="py-2">30 días</td>
          </tr>
          <tr className="border-b border-white/[0.06]">
            <td className="py-2 font-mono">next-auth.csrf-token</td>
            <td className="py-2">Proteger frente a peticiones falsificadas</td>
            <td className="py-2">Sesión</td>
          </tr>
        </tbody>
      </table>

      <h2 className="text-[14px] font-semibold text-foreground">2. Cómo desactivarlas</h2>
      <p>
        Puedes bloquear o eliminar las cookies desde la configuración de tu navegador; si bloqueas las técnicas, no
        podrás iniciar sesión en el panel.
      </p>

      <h2 className="text-[14px] font-semibold text-foreground">3. Cambios</h2>
      <p>
        Si en el futuro se añaden herramientas de analítica o publicidad, se actualizará esta política y se solicitará
        el consentimiento previo cuando sea exigible.
      </p>
    </>
  );
}
