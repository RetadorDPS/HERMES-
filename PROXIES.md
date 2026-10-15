# Proxies: la verdad sobre el «gratis» y cómo hacerlos tú mismo

Documento pedido a propósito: **¿hay forma de conseguir proxies residenciales gratis o crearlos nosotros?**
Respuesta corta: **gratis y de verdad, no existe. Baratos sí (1–3 €/mes para tu volumen). Y hacerlos tú
mismo es posible y legal si son conexiones tuyas.** Aquí está todo, con precios y con el material exacto.

---

## 1. Lo primero: ¿de verdad los necesitas?

Antes de gastar un céntimo, mira si puedes evitar el proxy. Por orden de preferencia:

| Camino | ¿Necesita proxy? | Estado en tu plataforma |
|---|---|---|
| **API oficial de AliExpress** (DS API) | **No** | Escrita, esperando tus claves |
| **API oficial de CJdropshipping** (V2.0) | **No** | Escrita, esperando tus claves |
| Catálogo servido por la plataforma | **No** (lo pide el servidor con tus claves) | Funcionando |
| Scraping de la web de un proveedor | **Sí, si te bloquean** | Funcionando con Playwright propio |
| Comprobar precio/stock de un producto | **Depende** | El camino ligero (`/scrape/price`) es el que más usa el robot 24/7 |

**Conclusión práctica:** para el día a día, las **APIs oficiales cubren casi todo** y no gastan proxy. Los
proxies son la red de seguridad para cuando quieras leer algo que la API no da (una web sin API, un
producto concreto, una tienda que bloquea).

## 2. Lo «gratis»: por qué no sirve (y por qué es peligroso)

- **Listas públicas de proxies gratuitos** (las que se encuentran buscando «free proxy list»): son
  prácticamente todas **de centro de datos** (Amazon, DigitalOcean, OVH…), ya quemadas, y los sitios
  serios las bloquean al instante. Además son un **riesgo de seguridad real**: quien monta ese proxy ve
  todo el tráfico que pasa por él y puede modificarlo. Con scraping de catálogo no expones contraseñas,
  pero sí te juegas que los datos que recibes sean falsos (precios manipulados).
- **Proxies «residenciales gratis» de Telegram/foros**: son redes de dispositivos infectados o robadas.
  Usarlos te mete en un problema legal y de reputación que no vale 20 €.
- **Pruebas gratuitas de proveedores serios**: existen pero son migajas. Smartproxy/Decodo da ~100 MB de
  prueba; Bright Data y Oxylabs dan prueba sólo a empresas y con registro; algunas dan crédito de bienvenida.
  Sirven para **probar que tu integración funciona**, no para trabajar.

**Resumen: si algo es «residencial y gratis», o no es residencial, o no es gratis, o no es legal.**

## 3. Lo barato de verdad (precios comprobados, 2026)

| Proveedor | Precio | Notas |
|---|---|---|
| **PacketStream** | **1 $/GB** (mínimo 50 $) | Red P2P con consentimiento. Rotación por país, sin ciudad. El más barato real |
| **DataImpulse** | **1 $/GB** | Pago por uso, sin caducidad |
| **IPRoyal** | 1,75–7 $/GB | El tráfico **no caduca**; 1,75 $/GB en volúmenes grandes. Hay preset en tu código |
| **Proxy-Cheap** | ~3 $/GB residencial | También centro de datos a ~0,30 $/IP |
| **Decodo (ex-Smartproxy)** | ~3,5–6 $/GB | Buena calidad; hay preset en tu código |
| **Bright Data / Oxylabs** | 4–8 $/GB | Los mejores para sitios duros; más caros. Hay preset |

### ¿Cuánto gastarías tú?

El robot, para comprobar precio y stock, usa el camino ligero: **una página sin imágenes ni vídeos**
(unos 150–500 KB de tráfico real). Cálculo para tu volumen actual:

```
9 productos × 24 comprobaciones/día × 30 días = 6.480 comprobaciones/mes
6.480 × 300 KB ≈ 1,9 GB/mes  →  con PacketStream/DataImpulse: ~2 $/mes
                                 con IPRoyal: ~3–13 $/mes
```

Con **100 clientes** de 50 productos sincronizando cada hora: ~3,6 M de comprobaciones/mes ≈ **1 TB/mes**.
Ahí los proxies dejan de ser calderilla (~1.000 $/mes a 1 $/GB) y la decisión correcta es **API oficial
+ caché + solo proxies para lo imprescindible** (que es exactamente como está diseñado).

## 4. Crearlos tú mismo: sí se puede (si son tus conexiones)

Tres caminos, de menos a más trabajo. **Los tres son legales** porque usas tus propias líneas.

### A. Tu conexión de casa (5 minutos, 0 €)
La conexión de tu casa **ya es un proxy residencial español**: para AliExpress es exactamente la IP que
quiere ver (precios en euros, país España). Las operadoras cambian la IP cada 24 h o al reconectar; se
puede forzar la reconexión desde el router.

- **Cómo se usa:** el scraper corre en tu ordenador y sale por tu línea; o montas ahí un proxy
  (`3proxy`, `Squid` o `tinyproxy`) y lo pones en `PROXY_LIST`.
- **Límite:** 1 IP (y unos pocos cambios al día). Suficiente para empezar y para probar, no para volumen.

### B. Tu móvil con datos (misma idea, IP móvil)
La IP de datos móviles es la que más confían los sitios (detrás de ella hay miles de personas). Un móvil
viejo o un router 4G con una SIM prepago **es un proxy móvil real**.

- **Material:** un móvil viejo o router 4G, SIM prepago de datos (10–20 €/mes o prepago por GB),
  y en el móvil/PC una app de proxy o directamente `3proxy`.
- **Ventaja:** rotación en un minuto (activar/desactivar datos da IP nueva del operador).

### C. Nodos propios con módems 4G (lo que hacen las empresas pequeñas)
Esto es lo que hacían los enlaces que has visto por ahí: **varios módems USB 4G con SIM, cada uno un
nodo**, en un mini PC o Raspberry Pi, con un proxy en cada uno y rotación de IP a demanda.

| Pieza | Precio aproximado | Nota |
|---|---|---|
| Módem USB 4G **Huawei E3372** (interfaz HiLink) | 25–45 € | Es el recomendado: hay librería libre para cambiar la IP por API (`huawei-lte-api`) |
| SIM prepago de datos (España) | 5–15 €/mes por SIM | Algunas tarifas ilimitadas baratas |
| Raspberry Pi 4/5 o mini PC usado | 60–120 € | Aquí van los módems y el proxy (`3proxy`) |
| **Total 2 nodos** | **~150–200 € + 20–30 €/mes** | 2 IPs móviles tuyas, rotando cuando quieras |

- **Rendimiento:** cada SIM rota en ~15–30 s y te da una IP nueva del operador; con 2–4 SIMs y rotación
  automática sacas decenas de IPs distintas al día, **todas reales y españolas**.
- **Cómo se enchufa a la plataforma:** el proxy de cada nodo expone una dirección tipo
  `http://usuario:clave@tu-casa.duckdns.org:3128`, y esa lista se pega en **`PROXY_LIST`** (ya soportado)
  o en la pantalla *Proxies y anti-bot → Validar*. **No hay que tocar código.**
- **Lo bueno de este camino:** un nodo móvil propio rinde más que 10 € de proxies compartidos, porque las
  IPs móviles españolas no están quemadas.
- **Lo malo:** consumo eléctrico y mantenimiento (si se cae la luz, te quedas sin nodos).

### Cómo comprobar que funciona
La plataforma ya trae el **validador con navegador real** (*Proxies y anti-bot*): pegas cada URL, la
prueba de verdad, te da nota y tiempo de respuesta, y las que fallan quedan en enfriamiento en vez de
estropear la sincronización. También `PROXY_REQUIRED=true` garantiza que el robot **nunca salga con la IP
del servidor** cuando haya proxies configurados.

## 5. Lo que NO hay que hacer (para que no te metas en un lío)

- **Recolectar el ancho de banda de otros** repartiendo una app «que paga por navegar» o metiendo un SDK
  en webs de terceros sin consentimiento explícito: en la UE eso choca con el RGPD y con las condiciones
  de los proveedores, y es el modelo de las redes que luego se investigan. Si algún día quisieras montar
  una red P2P así, hay que hacerlo con **consentimiento informado, pago y contratos** — es un negocio
  aparte, no un atajo.
- **Convertir en nodo un servidor tuyo** pensando que «cuela»: las IPs de centro de datos se detectan
  igual, da lo mismo que el servidor sea tuyo.
- **Comprar listas «residenciales» baratísimas de dudosa procedencia**: si no hay proveedor con nombre y
  condiciones, es una red robada.
- **Usar proxies para saltarte límites de un proveedor con el que tienes contrato** (por ejemplo, sortear
  la cuota de la API oficial): además de arriesgarte a que te cierren la cuenta, va contra sus términos.

## 6. Recomendación para ti, en una frase

Para empezar: **usa las APIs oficiales (ya las tienes pedidas) y no gastes nada**. Si quieres scraping
propio de respaldo, abre cuenta en **PacketStream o DataImpulse con 10 $ (≈ 10 GB ≈ 5 meses de tu
volumen actual)** y listo: no hay que montar nada. Y si te gusta el camino del medio, un **módem 4G con
SIM prepago enchufado a un mini PC** te da una IP móvil española propia por unos 10 € al mes, y se conecta
a la plataforma pegando una línea en `PROXY_LIST`. Cuando el negocio crezca, los proxies compartidos se
vuelven caros y **el diseño de la plataforma ya evita depender de ellos**.

---

### Variables útiles (ya soportadas)
```bash
PROXY_LIST="http://usuario:clave@nodo1.dominio:3128,http://usuario:clave@nodo2.dominio:3128"
PROXY_ROTATION="round-robin"        # round-robin | random
PROXY_PROVIDER="iproyal"            # brightdata | oxylabs | smartproxy | iproyal | webshare | custom
PROXY_COUNTRY="es"                  # país de salida (para ver precios de España)
PROXY_REQUIRED="false"              # true = nunca salir con la IP del servidor
```
