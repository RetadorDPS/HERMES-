#!/usr/bin/env python3
"""
Envuelve los manejadores de rutas API y las páginas del panel en el contexto
del cliente (`withCurrentTenant`), de modo que TODAS las consultas queden
filtradas por el usuario que ha iniciado sesión.

Uso:  python3 scripts/wrap-tenant.py           (aplica los cambios)
      python3 scripts/wrap-tenant.py --dry    (solo muestra qué haría)
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DRY = '--dry' in sys.argv

API_FILES = [
    'src/app/api/import/route.ts',
    'src/app/api/products/route.ts',
    'src/app/api/products/[id]/route.ts',
    'src/app/api/stores/route.ts',
    'src/app/api/stores/[id]/test/route.ts',
    'src/app/api/orders/route.ts',
    'src/app/api/kpis/route.ts',
    'src/app/api/sync/route.ts',
    'src/app/api/scrape/route.ts',
    'src/app/api/supplier-accounts/route.ts',
    'src/app/api/supplier-accounts/[id]/route.ts',
]

PAGE_FILES = [
    'src/app/(dashboard)/dashboard/page.tsx',
    'src/app/(dashboard)/import/page.tsx',
    'src/app/(dashboard)/products/page.tsx',
    'src/app/(dashboard)/products/[id]/page.tsx',
    'src/app/(dashboard)/orders/page.tsx',
    'src/app/(dashboard)/monitor/page.tsx',
    'src/app/(dashboard)/stores/page.tsx',
    'src/app/(dashboard)/pricing/page.tsx',
    'src/app/(dashboard)/settings/page.tsx',
    'src/app/(dashboard)/suppliers/page.tsx',
    'src/app/(dashboard)/billing/page.tsx',
]

IMPORT_LINE_API = "import { withCurrentTenant, requireUserId } from '@/lib/tenant';"
IMPORT_LINE_PAGE = "import { withCurrentTenant } from '@/lib/tenant';"


def find_function_body(text: str, start: int) -> int:
    """Devuelve el índice del cierre (}) de la función que empieza en `start`."""
    i = start
    depth = 0
    in_str = None
    in_line_comment = False
    in_block_comment = False
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if in_line_comment:
            if ch == '\n':
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            if ch == '*' and nxt == '/':
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == in_str:
                in_str = None
            i += 1
            continue
        if ch == '/' and nxt == '/':
            in_line_comment = True
            i += 2
            continue
        if ch == '/' and nxt == '*':
            in_block_comment = True
            i += 2
            continue
        if ch in '"\'`':
            in_str = ch
            i += 1
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError('no se encontró el cierre de la función')


def indent(block: str, spaces: int = 2) -> str:
    pad = ' ' * spaces
    return '\n'.join((pad + line) if line.strip() else line for line in block.split('\n'))


def wrap_handlers(path: pathlib.Path, is_page: bool) -> str:
    text = path.read_text(encoding='utf-8')
    if 'withCurrentTenant' in text:
        return 'ya envuelto'

    pattern = re.compile(r'export (?:async )?function (GET|POST|PUT|PATCH|DELETE|default)\s*\(') if not is_page \
        else re.compile(r'export default async function (\w+)\s*\(')

    changed = 0
    # Se procesan de atrás hacia delante para no invalidar los índices
    for match in reversed(list(pattern.finditer(text))):
        # localizar la llave de apertura del cuerpo
        brace = text.find('{', match.end() - 1)
        # puede haber parámetros multilinea: buscar la primera { tras el paréntesis de cierre
        depth = 0
        i = match.end() - 1
        while i < len(text):
            if text[i] == '(':
                depth += 1
            elif text[i] == ')':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        brace = text.find('{', i)
        close = find_function_body(text, brace)

        body = text[brace + 1:close]
        # Los handlers que ya devuelven una Response no necesitan cambios de tipo
        wrapped = f"{'{'}\n    return withCurrentTenant(async (userId) => {{{indent(body, 4)}\n    }});\n  {'}'}"
        # Elimina el userId ya resuelto dentro del cuerpo si existía (ahora viene del contexto)
        wrapped = re.sub(r'const userId = await (?:requireUserId|getDefaultUserId)\(\);', '// userId resuelto por el contexto de inquilino', wrapped)
        wrapped = wrapped.replace('await requireUserId()', 'userId').replace("await getDefaultUserId()", "userId")

        text = text[:brace] + wrapped + text[close + 1:]
        changed += 1

    if not changed:
        return 'sin manejadores'

    import_line = IMPORT_LINE_PAGE if is_page else IMPORT_LINE_API
    if "from '@/lib/tenant'" not in text:
        # inserta tras el último import existente
        imports = list(re.finditer(r"^import .*?;\s*$", text, flags=re.M))
        if imports:
            pos = imports[-1].end()
            text = text[:pos] + f"\n{import_line}" + text[pos:]
        else:
            text = import_line + '\n' + text

    path.write_text(text, encoding='utf-8')
    return f'{changed} manejador(es) envuelto(s)'


def main():
    for rel in API_FILES:
        p = ROOT / rel
        if not p.exists():
            print(f'· {rel}: no existe (se omite)')
            continue
        status = wrap_handlers(p, is_page=False) if not DRY else 'dry-run'
        print(f'· {rel}: {status}')

    for rel in PAGE_FILES:
        p = ROOT / rel
        if not p.exists():
            print(f'· {rel}: no existe (se omite)')
            continue
        status = wrap_handlers(p, is_page=True) if not DRY else 'dry-run'
        print(f'· {rel}: {status}')


if __name__ == '__main__':
    main()
