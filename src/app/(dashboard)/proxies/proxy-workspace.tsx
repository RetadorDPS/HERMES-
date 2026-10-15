'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Globe, Loader2, PlugZap, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface PoolStatus {
  ok: boolean;
  serviceUp: boolean;
  count?: number;
  strategy?: string;
  provider?: string | null;
  country?: string;
  pool?: { proxy: string; successes: number; failures: number; score: number; cooldown: boolean; last_error: string | null }[];
  hint?: string;
}

interface TestResult {
  proxy: string;
  ok: boolean;
  status: 'ok' | 'blocked' | 'error';
  exitIp?: string | null;
  latencyMs: number;
  error?: string | null;
}

const PROVIDERS = [
  { name: 'Bright Data', gateway: 'brd.superproxy.io:33335', user: 'brd-customer-hl_XXXXXXX-zone-residential', price: '≈ 8 $/GB residencial', note: 'El más fiable; pago por GB' },
  { name: 'Oxylabs', gateway: 'pr.oxylabs.io:7777', user: 'user-XXXXX', price: '≈ 8 $/GB', note: 'Buena cobertura ES/EU' },
  { name: 'Smartproxy', gateway: 'gate.smartproxy.com:7000', user: 'user-XXXX', price: '≈ 7 $/GB', note: 'Plan desde 50 $/mes' },
  { name: 'IPRoyal', gateway: 'geo.iproyal.com:12321', user: 'tu-usuario', price: '≈ 7 $/GB', note: 'Pago por uso, sin suscripción' },
  { name: 'Webshare', gateway: 'p.webshare.io:80', user: 'tu-usuario', price: '≈ 30 $/mes', note: 'Más barato (datacenter/ISP)' },
];

const ENV_SNIPPET = `# ── Proxy residencial rotativo (recomendado) ──────────────────
PROXY_PROVIDER="brightdata"          # brightdata | oxylabs | smartproxy | iproyal | webshare | custom
PROXY_USERNAME="brd-customer-hl_XXXXXXX-zone-residential"
PROXY_PASSWORD="tu-password-del-proveedor"
PROXY_COUNTRY="es"                   # país de salida desiderado
PROXY_SESSIONS="12"                  # sesiones rotativas en el pool
PROXY_SESSION_TTL_MIN="10"           # minutos de sesión fija
PROXY_REQUIRED="true"                # no salir nunca con la IP del servidor

# ── Alternativa: lista explícita de proxies ───────────────────
PROXY_LIST="http://user:pass@host1:port,http://user:pass@host2:port"`;

export function ProxyWorkspace({ initial }: { initial: PoolStatus }) {
  const [status, setStatus] = useState<PoolStatus>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState('');
  const [targetUrl, setTargetUrl] = useState('https://es.aliexpress.com/item/1005006123456789.html');
  const [timeoutMs, setTimeoutMs] = useState(25000);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [summary, setSummary] = useState<{ tested: number; working: number; fastest: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/proxies', { cache: 'no-store' });
      setStatus(await res.json());
    } finally {
      setRefreshing(false);
    }
  };

  const test = async () => {
    const proxies = input
      .split(/[\n,;]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (p.includes('://') ? p : `http://${p}`));

    if (!proxies.length) {
      setError('Pega al menos un proxy (formato host:puerto o http://usuario:clave@host:puerto)');
      return;
    }

    setTesting(true);
    setError(null);
    setResults(null);
    setSummary(null);
    try {
      const res = await fetch('/api/proxies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxies, targetUrl: targetUrl || null, timeoutMs }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'La validación falló');
        return;
      }
      setResults(json.results);
      setSummary({ tested: json.tested, working: json.working, fastest: json.fastest ?? null });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  const workingCount = status.pool?.filter((p) => !p.cooldown).length ?? 0;

  return (
    <div className="space-y-4">
      {/* ── Estado del pool ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PlugZap className="size-4 text-indigo-300" />
              Pool de proxies activo
              <Badge variant={status.serviceUp ? 'success' : 'danger'}>{status.serviceUp ? 'scraper conectado' : 'scraper caído'}</Badge>
            </CardTitle>
            <CardDescription>
              {status.serviceUp
                ? `${status.count ?? 0} proxies configurados · estrategia ${status.strategy} · país ${status.country ?? '—'} · proveedor ${status.provider ?? 'lista manual'}`
                : status.hint}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            Refrescar
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {status.serviceUp && status.count === 0 && (
            <Alert variant="warning" title="No hay ningún proxy configurado: estás saliendo con la IP del servidor">
              Los proveedores como AliExpress bloquean las IPs de datacenter (lo hemos comprobado en vivo: devuelven captcha). Configura un
              proveedor residencial abajo, o la plataforma caerá al modo demo etiquetado cada vez que intente extraer.
            </Alert>
          )}

          {status.pool && status.pool.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2 text-[12px]">
                <span className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">{workingCount} operativos</span>
                <span className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-amber-300">
                  {status.pool.filter((p) => p.cooldown).length} en cooldown
                </span>
                <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-muted-foreground">
                  {status.pool.reduce((a, p) => a + p.successes, 0)} aciertos · {status.pool.reduce((a, p) => a + p.failures, 0)} fallos
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proxy (sin credenciales)</TableHead>
                    <TableHead className="text-right">Aciertos</TableHead>
                    <TableHead className="text-right">Fallos</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Último error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.pool.map((p) => (
                    <TableRow key={p.proxy}>
                      <TableCell className="font-mono text-[11px]">{p.proxy}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-400">{p.successes}</TableCell>
                      <TableCell className="text-right tabular-nums text-rose-400">{p.failures}</TableCell>
                      <TableCell className="text-right tabular-nums">{(p.score * 100).toFixed(0)}%</TableCell>
                      <TableCell>{p.cooldown ? <Badge variant="warning">cooldown</Badge> : <Badge variant="success">listo</Badge>}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-[11px] text-muted-foreground">{p.last_error ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          {!status.serviceUp && (
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
              <p className="text-[11px] text-muted-foreground">Arranca el microservicio para gestionar proxies:</p>
              <code className="mt-1 block font-mono text-[12px] text-indigo-300">npm run scraper:dev</code>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Validador ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-300" />
            Validador de proxies (navegador real)
          </CardTitle>
          <CardDescription>
            Pega tus proxies (uno por línea). Se abre Chromium a través de cada uno, se obtiene la IP de salida, la latencia y se comprueba si el
            proveedor objetivo bloquea esa IP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-1.5">
              <Label htmlFor="proxy-list">Lista de proxies</Label>
              <Textarea
                id="proxy-list"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={'http://usuario:clave@brd.superproxy.io:33335\nhttp://usuario:clave@pr.oxylabs.io:7777\n1.2.3.4:8080'}
                className="h-[132px] font-mono text-[12px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Máximo 25 por lote. Las credenciales nunca salen del servidor: en los resultados sólo se muestra <code>host:puerto</code>.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="target">URL objetivo del test</Label>
                <Input id="target" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} className="font-mono text-[11px]" />
                <p className="text-[11px] text-muted-foreground">Déjalo vacío para comprobar sólo la conectividad y la IP de salida.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="timeout">Timeout por proxy</Label>
                <Select id="timeout" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))}>
                  <option value={10000}>10 s (rápido)</option>
                  <option value={25000}>25 s (recomendado)</option>
                  <option value={45000}>45 s (proxies lentos)</option>
                </Select>
              </div>
              <Button variant="gradient" className="w-full" onClick={test} disabled={testing}>
                {testing ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                {testing ? 'Validando con navegador…' : 'Validar proxies'}
              </Button>
            </div>
          </div>

          {error && (
            <Alert variant="danger" title="No se pudo validar" onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}

          {summary && results && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <Badge variant={summary.working > 0 ? 'success' : 'danger'}>
                  {summary.working}/{summary.tested} operativos
                </Badge>
                {summary.fastest && <Badge variant="info">más rápido: {summary.fastest} ms</Badge>}
                {summary.working === 0 && (
                  <span className="text-muted-foreground">
                    Ninguno sirve: revisa credenciales, país de salida o cambia de proveedor. Los proxies gratuitos suelen fallar aquí.
                  </span>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proxy</TableHead>
                    <TableHead>IP de salida</TableHead>
                    <TableHead className="text-right">Latencia</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>Detalle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.proxy}>
                      <TableCell className="font-mono text-[11px]">{r.proxy}</TableCell>
                      <TableCell className="font-mono text-[11px]">{r.exitIp ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.latencyMs} ms</TableCell>
                      <TableCell>
                        {r.status === 'ok' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="size-3.5" /> operativo
                          </span>
                        ) : r.status === 'blocked' ? (
                          <span className="inline-flex items-center gap-1 text-amber-400">
                            <AlertTriangle className="size-3.5" /> bloqueado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-400">
                            <XCircle className="size-3.5" /> error
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[320px] text-[11px] text-muted-foreground">
                        {r.error ? r.error.split('\n')[0].slice(0, 110) : 'Conexión correcta'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {summary.working > 0 && (
                <Alert variant="info" title="Cómo activar los que funcionan">
                  Pega los proxies válidos en <code>PROXY_LIST</code> dentro de <code>.env.local</code> (o configura <code>PROXY_PROVIDER</code> con tu
                  gateway rotativo) y reinicia el scraper: <code>npm run scraper:dev</code>.
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Cómo conseguir proxies ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Proveedores residenciales recomendados</CardTitle>
            <CardDescription>
              Yo no puedo contratarlos por ti: requieren cuenta y pago. Estos son los gateways que la plataforma ya sabe configurar sola.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {PROVIDERS.map((p) => (
              <div key={p.name} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium">{p.name}</span>
                  <Badge variant="outline">{p.price}</Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{p.note}</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <code className="truncate rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">{p.gateway}</code>
                  <button onClick={() => copy(p.gateway, p.name)} className="shrink-0 text-muted-foreground transition hover:text-foreground" title="Copiar">
                    {copied === p.name ? <CheckCircle2 className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  </button>
                </div>
              </div>
            ))}
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              Para scraping de dropshipping el consumo típico es de <strong>2-5 GB/mes</strong> (≈ 20-40 $): cada PAS completo pesa ~1-2 MB y los
              workers sólo recargan el payload de precio cuando hace falta.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuración exacta</CardTitle>
            <CardDescription>Pega esto en .env.local y reinicia el microservicio de scraping</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <pre className="max-h-[240px] overflow-auto rounded-lg border border-white/[0.06] bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-indigo-200">
{ENV_SNIPPET}
              </pre>
              <Button variant="outline" size="sm" className="absolute right-2 top-2" onClick={() => copy(ENV_SNIPPET, 'env')}>
                {copied === 'env' ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">Qué hace la plataforma con esto:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Genera el pool de URLs rotativas con país y sesión por proveedor (sin que escribas las convenciones raras de cada uno).</li>
                <li>Si un proxy falla 3 veces seguidas, entra en <strong>cooldown automático</strong> y se rota a otro.</li>
                <li>Cada reintento de scraping sale por una IP distinta.</li>
                <li>Con <code>PROXY_REQUIRED=true</code> el scraper nunca sale con la IP del servidor: si no hay proxies, falla en vez de quemarla.</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-[13px]">¿Sin presupuesto para proxies? Alternativa oficial</CardTitle>
          <CardDescription>APIs oficiales de proveedor: datos estructurados, sin anti-bot y legalmente sólidas</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-[12px] text-muted-foreground md:grid-cols-2">
          <p>• <strong>AliExpress Open Platform</strong> (aliexpress.ds.product.get / ds.order.create): afiliación gratuita, devuelve precio, stock y permite comprar pedidos.</p>
          <p>• <strong>CJ Dropshipping API</strong>: ya implementada en el extractor <code>cj.hybrid_v1</code>; añade <code>CJ_API_KEY</code> y usa la API en lugar del scraping.</p>
          <p>• <strong>Amazon PA-API 5.0</strong>: requiere cuenta de afiliado con ventas; sin scraping y con imágenes HD incluidas.</p>
          <p>• Los extractores de scraping quedan entonces como <em>fallback</em> para productos o proveedores sin API.</p>
        </CardContent>
      </Card>
    </div>
  );
}
