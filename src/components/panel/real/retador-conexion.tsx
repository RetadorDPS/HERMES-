"use client";

/**
 * Tarjeta «Retador» de la pantalla de tiendas: vincula la cuenta del vendedor con Retador (sin claves que pegar), muestra las tarifas
 * reales de Retador y permite revisar el estado de lo publicado o desvincular.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlugZap,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { obtenerPerfil } from "@/lib/real/datos";
import {
  llamarTienda,
  obtenerTiendaRetador,
  type TiendaRetador,
} from "@/lib/real/retador";
import { ProductosRetador } from "./productos-retador";
import { BloqueVincular } from "./vincular-retador";

const TOKEN_PRUEBA = "dsp_sim_demostracion_0001";

const usd = (n: number) => `${n.toFixed(2)} USD`;

export function RetadorConexion() {
  const [tienda, setTienda] = useState<TiendaRetador | null>(null);
  const [esAdmin, setEsAdmin] = useState(false);
  const [cargada, setCargada] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Recarga la tienda sin vaciar la tarjeta, para que los mensajes de la acción no se pierdan. */
  const alCambiar = useCallback(async () => {
    try {
      setTienda(await obtenerTiendaRetador());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargada(true);
    }
  }, []);

  useEffect(() => {
    void alCambiar();
    obtenerPerfil()
      .then((c) => setEsAdmin(c.perfil?.role === "ADMIN"))
      .catch(() => setEsAdmin(false));
  }, [alCambiar]);

  const conectada = tienda?.status === "CONNECTED";

  async function ejecutar(
    etiqueta: string,
    accion: () => Promise<string | void>,
  ) {
    setOcupado(etiqueta);
    setError(null);
    setAviso(null);
    try {
      const mensaje = await accion();
      await alCambiar();
      if (mensaje) setAviso(mensaje);
    } catch (e) {
      setError((e as Error).message);
      await alCambiar();
    } finally {
      setOcupado(null);
    }
  }

  const conectar = (t: string) =>
    ejecutar("conectar", async () => {
      await llamarTienda({ accion: "conectar", token: t });
      return "Retador simulado conectado (solo pruebas).";
    });

  return (
    <>
      <Card data-tour="retador-conexion">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <PlugZap className="size-4 text-indigo-300" /> Retador
            </CardTitle>
            {conectada && <Badge variant="success">Vinculada</Badge>}
            {tienda?.status === "ERROR" && (
              <Badge variant="danger">Con error</Badge>
            )}
            {tienda?.status === "DISCONNECTED" && (
              <Badge variant="outline">Sin vincular</Badge>
            )}
            {tienda?.simulada && (
              <Badge variant="warning">Simulada · solo pruebas</Badge>
            )}
          </div>
          <CardDescription>
            Retador y DropshipPilot funcionan como una sola plataforma: vincula tu cuenta, publica tus productos de CJ y AliExpress
            en tu tienda de Retador y mantenlos al día desde aquí.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!cargada && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Comprobando tu
              conexión con Retador…
            </p>
          )}
          {error && <Alert variant="danger">{error}</Alert>}
          {aviso && <Alert variant="success">{aviso}</Alert>}

          {!conectada && tienda?.lastError && (
            <Alert variant="warning" title="Hay que vincular de nuevo">
              {tienda.lastError}
            </Alert>
          )}

          {conectada && tienda && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                <Dato
                  titulo={tienda.planConjunto ? "Tu plan (viene de Retador)" : "Plan en Retador"}
                  valor={
                    tienda.plan ? tienda.plan.toUpperCase() : "No informado"
                  }
                />
                <Dato
                  titulo="Productos"
                  valor={
                    tienda.topeProductos != null
                      ? `${tienda.productosUsados ?? "—"} de ${tienda.topeProductos}`
                      : `${tienda.publicados} publicados desde aquí`
                  }
                />
                <Dato
                  titulo="Tarifa de envío de Retador"
                  valor={
                    tienda.tarifas
                      ? `${tienda.tarifas.hubUsdPorLibra.toFixed(2)} USD/lb`
                      : "No informado"
                  }
                />
                <Dato
                  titulo="Comisión de Retador"
                  valor={
                    tienda.tarifas
                      ? `${tienda.tarifas.comisionPctGanancia}% de la ganancia`
                      : "No informado"
                  }
                />
                <Dato
                  titulo="Pasarela de pago"
                  valor={
                    tienda.tarifas
                      ? `${tienda.tarifas.pasarelaPct}% + ${usd(tienda.tarifas.pasarelaFijaUsd)}${tienda.tarifas.pasarelaACargo === "comprador" ? " (la paga el comprador)" : tienda.tarifas.pasarelaACargo === "retador" ? " (la asume Retador)" : " (la pagas tú, sobre el total que paga el comprador)"}`
                      : "No informado"
                  }
                />
                <Dato
                  titulo="Tránsito de Retador"
                  valor={
                    tienda.tarifas && tienda.tarifas.diasHubCuba[1] > 0
                      ? `${tienda.tarifas.diasHubCuba[0]}–${tienda.tarifas.diasHubCuba[1]} días`
                      : "No informado"
                  }
                />
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!ocupado}
                  onClick={() =>
                    ejecutar("config", async () => {
                      await llamarTienda({
                        accion: "config",
                        storeId: tienda.id,
                      });
                      return "Datos de Retador actualizados.";
                    })
                  }
                >
                  {ocupado === "config" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}{" "}
                  Actualizar datos
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!ocupado}
                  onClick={() =>
                    ejecutar("estado", async () => {
                      const r = await llamarTienda<{
                        productos: unknown[];
                        diferencias: { mensaje: string }[];
                      }>({ accion: "estado", storeId: tienda.id });
                      if (r.diferencias.length)
                        return `${r.productos.length} productos revisados. Atención: ${r.diferencias.map((d) => d.mensaje).join(" ")}`;
                      return r.productos.length
                        ? `${r.productos.length} productos revisados: todo coincide con Retador.`
                        : "Todavía no has publicado productos en Retador.";
                    })
                  }
                >
                  {ocupado === "estado" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <CheckCircle2 />
                  )}{" "}
                  Revisar lo publicado
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-rose-300 hover:text-rose-200"
                  disabled={!!ocupado}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "¿Desvincular Retador? Tus productos seguirán publicados en Retador, pero dejarán de actualizarse desde aquí hasta que vuelvas a vincular tu cuenta.",
                      )
                    )
                      return;
                    void ejecutar("desconectar", async () => {
                      const r = await llamarTienda<{ aviso: string | null }>({
                        accion: "desconectar",
                        storeId: tienda.id,
                      });
                      return r.aviso ?? "Cuenta desvinculada de Retador.";
                    });
                  }}
                >
                  {ocupado === "desconectar" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Unplug />
                  )}{" "}
                  Desvincular
                </Button>
              </div>
            </>
          )}

          {cargada && !conectada && (
            <div className="space-y-3">
              <BloqueVincular alVincular={alCambiar} />
              {esAdmin && (
                <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <AlertTriangle className="size-3.5 text-amber-300" /> Solo
                  administrador:
                  <button
                    type="button"
                    className="text-indigo-300 underline-offset-2 hover:underline"
                    disabled={!!ocupado}
                    onClick={() => void conectar(TOKEN_PRUEBA)}
                  >
                    conectar con el Retador simulado
                  </button>
                  (no publica nada real).
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {conectada && tienda && <ProductosRetador tienda={tienda} />}
    </>
  );
}

function Dato({
  titulo,
  valor,
  aviso,
}: {
  titulo: string;
  valor: string;
  aviso?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {titulo}
      </dt>
      <dd className={aviso ? "font-medium text-amber-300" : "font-medium"}>
        {valor}
      </dd>
    </div>
  );
}
