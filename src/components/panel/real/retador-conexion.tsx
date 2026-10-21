"use client";

/**
 * Tarjeta «Retador» de la pantalla de tiendas: conecta la tienda del vendedor con su token, muestra las tarifas
 * reales de Retador y permite revisar el estado de lo publicado o desconectar.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
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
import { Input } from "@/components/ui/input";
import { obtenerPerfil } from "@/lib/real/datos";
import {
  llamarTienda,
  obtenerTiendaRetador,
  type TiendaRetador,
} from "@/lib/real/retador";
import { ProductosRetador } from "./productos-retador";

const TOKEN_PRUEBA = "dsp_sim_demostracion_0001";

const diasHasta = (f: Date | null) =>
  f ? Math.ceil((f.getTime() - Date.now()) / 86_400_000) : null;
const usd = (n: number) => `${n.toFixed(2)} USD`;

export function RetadorConexion() {
  const [tienda, setTienda] = useState<TiendaRetador | null>(null);
  const [esAdmin, setEsAdmin] = useState(false);
  const [cargada, setCargada] = useState(false);
  const [token, setToken] = useState("");
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
      setToken("");
      return "Retador conectada. Ya puedes publicar productos desde el catálogo.";
    });

  const dias = diasHasta(tienda?.token?.caducaEn ?? null);

  return (
    <>
      <Card data-tour="retador-conexion">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <PlugZap className="size-4 text-indigo-300" /> Retador
            </CardTitle>
            {conectada && <Badge variant="success">Conectada</Badge>}
            {tienda?.status === "ERROR" && (
              <Badge variant="danger">Con error</Badge>
            )}
            {tienda?.status === "DISCONNECTED" && (
              <Badge variant="outline">Desconectada</Badge>
            )}
            {tienda?.simulada && (
              <Badge variant="warning">Simulada · solo pruebas</Badge>
            )}
          </div>
          <CardDescription>
            Publica tus productos de CJ y AliExpress en tu tienda de Retador
            y mantenlos al día desde aquí.
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

          {tienda?.status === "ERROR" && tienda.lastError && (
            <Alert variant="warning" title="Hay que reconectar">
              {tienda.lastError}
            </Alert>
          )}

          {conectada && tienda && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                <Dato
                  titulo="Plan en Retador"
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
                <Dato
                  titulo="Token"
                  valor={
                    tienda.token?.prefijo ? `${tienda.token.prefijo}…` : "—"
                  }
                />
                <Dato
                  titulo="Caduca"
                  valor={
                    dias == null
                      ? "No informado"
                      : dias < 0
                        ? "Caducado"
                        : `en ${dias} días`
                  }
                  aviso={dias != null && dias <= 14}
                />
              </dl>
              {dias != null && dias <= 14 && (
                <Alert
                  variant="warning"
                  title={
                    dias < 0 ? "El token ha caducado" : "El token caduca pronto"
                  }
                >
                  Crea un token nuevo en Retador y pégalo abajo antes de que
                  caduque para que no se detenga la sincronización.
                </Alert>
              )}
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
                        "¿Desconectar Retador? Tus productos seguirán publicados en Retador, pero dejarán de actualizarse desde aquí.",
                      )
                    )
                      return;
                    void ejecutar("desconectar", async () => {
                      const r = await llamarTienda<{ aviso: string | null }>({
                        accion: "desconectar",
                        storeId: tienda.id,
                      });
                      return r.aviso ?? "Retador desconectada.";
                    });
                  }}
                >
                  {ocupado === "desconectar" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Unplug />
                  )}{" "}
                  Desconectar
                </Button>
              </div>
            </>
          )}

          {cargada && (!conectada || (dias != null && dias <= 14)) && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim()) void conectar(token.trim());
              }}
            >
              {!conectada && (
                <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground">
                  <li>
                    En Retador, abre la sección de conexiones de tu cuenta y
                    crea un token para DropshipPilot (solo se muestra una vez).
                  </li>
                  <li>
                    Pégalo aquí y pulsa «Conectar». Se guarda cifrado y solo
                    sirve para publicar y actualizar tus productos.
                  </li>
                  <li>Puedes revocarlo en Retador cuando quieras.</li>
                </ol>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <KeyRound className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="pl-8 font-mono"
                    placeholder="dsp_…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Token de Retador"
                  />
                </div>
                <Button
                  type="submit"
                  variant="gradient"
                  disabled={!!ocupado || !token.trim()}
                >
                  {ocupado === "conectar" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <PlugZap />
                  )}{" "}
                  {conectada ? "Cambiar token" : "Conectar"}
                </Button>
              </div>
              {esAdmin && !conectada && (
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
            </form>
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
