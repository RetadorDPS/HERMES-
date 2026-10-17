import { Topbar } from '@/components/layout/topbar';
import { dataMode } from '@/lib/data';
import { ProxyWorkspace } from './proxy-workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Proxies y anti-bot' };

async function fetchPool() {
  const url = process.env.SCRAPER_SERVICE_URL?.replace(/\/$/, '');
  if (!url) return { ok: false, serviceUp: false, hint: 'SCRAPER_SERVICE_URL no configurada en .env.local' };
  try {
    const res = await fetch(`${url}/proxies`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return { ok: true, serviceUp: true, ...(await res.json()) };
  } catch (err) {
    return {
      ok: false,
      serviceUp: false,
      hint: `El microservicio de scraping no responde en ${url}. Arrástralo con \`npm run scraper:dev\` desde services/scraper.`,
    };
  }
}

export default async function ProxiesPage() {
  const pool = await fetchPool();

  return (
    <>
      <Topbar
        title="Proxies y anti-bot"
        subtitle="Configura proxies residenciales para extraer de AliExpress/Amazon sin bloqueos y valídalos con navegador real"
        mode={dataMode()}
      />
      <div data-tour="screen:proxies" className="py-3">
        <ProxyWorkspace initial={pool as any} />
      </div>
    </>
  );
}
