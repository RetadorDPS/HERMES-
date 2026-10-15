# 📄 Contrato de encargado del tratamiento (DPA)

**Plantilla para usar con tus clientes cuando les vendas el servicio.**

> ⚠️ **Esto es una plantilla, no asesoría jurídica.** Está redactada siguiendo el
> artículo 28 del RGPD y la guía de la AEPD, pero **debe revisarla un profesional**
> antes de firmarla con clientes reales. Sustituye todo lo que va entre `[CORCHETES]`.

---

## Por qué lo necesitas

Cuando un cliente tuyo vende en su tienda y tú guardas sus pedidos, **tú tratas datos
personales de sus compradores** (nombre, dirección, teléfono, correo). Tú eres el
**encargado del tratamiento** y tu cliente es el **responsable**. La ley exige que exista
un contrato escrito entre ambos. Sin él, responder de una brecha es mucho más caro.

Se firma **una vez por cliente** (puede ser electrónicamente) y aplica a todas sus tiendas.

---

## CONTRATO DE ENCARGADO DEL TRATAMIENTO DE DATOS PERSONALES

**Entre** `[TU NOMBRE O RAZÓN SOCIAL]`, con NIF `[TU NIF]` y domicilio en `[TU DIRECCIÓN]`
(en adelante, **el Encargado**),

**y** `[NOMBRE O RAZÓN SOCIAL DEL CLIENTE]`, con NIF `[NIF]` y domicilio en `[DIRECCIÓN]`
(en adelante, **el Responsable**).

### 1. Objeto y finalidad

El Responsable utiliza la plataforma **DropshipPilot** (en adelante, «la Plataforma»),
prestada por el Encargado, para gestionar su tienda `[Shopify / WooCommerce]` y sus
pedidos. Para ello, el Encargado tratará los datos personales de los compradores del
Responsable con la única finalidad de prestar ese servicio:

- importar y sincronizar productos, precios y stock;
- recibir, registrar y **reenviar los pedidos al proveedor** para su envío;
- comunicar el estado del pedido y el número de seguimiento al consumidor.

**No se realiza ninguna otra finalidad**, y en particular no se usan los datos para
publicidad, elaboración de perfiles ni cesión a terceros distintos de los previstos.

### 2. Categorías de datos y de interesados

| Interesados | Datos tratados |
|---|---|
| Compradores del Responsable | Nombre y apellidos, correo electrónico, teléfono, dirección postal de entrega, contenido e importe del pedido, número de seguimiento |
| — (categorías especiales) | **Ninguna.** El Encargado no trata datos de salud, ideología, biometría ni similares |

### 3. Obligaciones del Encargado

1. Tratar los datos **solo siguiendo instrucciones documentadas** del Responsable.
2. Guardar **confidencialidad** y exigirla a su personal y colaboradores.
3. Aplicar las medidas de seguridad del **Anexo I**.
4. **No subcontratar** nada del tratamiento sin autorización del Responsable. El
   Responsable autoriza ya los subencargados del **Anexo II**, y será informado con
   antelación de cualquier cambio.
5. Asistir al Responsable en las solicitudes de ejercicio de derechos
   (acceso, rectificación, supresión, oposición, limitación y portabilidad), en un
   plazo máximo de **5 días laborables** desde la petición del Responsable. Para
   acelerarlo, la plataforma ya trae los derechos de **acceso, portabilidad y
   supresión autoservicio**: el propio interesado descarga sus datos en JSON
   (`GET /api/account/export`) y puede borrar su cuenta y todos sus datos
   (`DELETE /api/account`) desde *Configuración → Tus datos y tu cuenta*, sin
   intervención del Encargado.
6. **Notificar cualquier brecha de seguridad** al Responsable **sin dilación indebida y
   en un máximo de 48 horas** desde que tenga conocimiento, con la información disponible;
   se compromete a completarla en un máximo de 72 horas (para que el Responsable pueda
   cumplir su plazo legal de 72 h ante la AEPD).
7. Realizar una **evaluación de impacto** y consultas previas cuando proceda, con la
   asistencia del Encargado.
8. **Suprimir o devolver** los datos al terminar el contrato (ver cláusula 6).
9. Permitir **auditorías** razonables (cuestionarios, informes o, como máximo una vez al
   año, auditoría in situ con 15 días de aviso), respetando la confidencialidad de otros
   clientes.
10. Nombrar un **contacto técnico** para cuestiones de protección de datos:
    `[CORREO DE CONTACTO]`.

### 4. Obligaciones del Responsable

1. Entregar los datos en condiciones legales (base jurídica, información al comprador).
2. Responder ante el comprador y ante la AEPD en su condición de responsable.
3. No pedir al Encargado tratamientos ilegales o desproporcionados.

### 5. Duración

Coincide con la vigencia del servicio contratado. Las obligaciones de confidencialidad y
de borrado sobreviven a la terminación.

### 5 bis. Qué queda cuando alguien borra su cuenta

El borrado arrastra, en cascada, tiendas, productos, variantes, imágenes, reseñas,
pedidos y sus líneas, reglas de precio, cuentas de proveedor, historial de
sincronización y la suscripción (cancelada antes de borrar en Stripe o Lemon
Squeezy). Se conserva **una única entrada en el registro de auditoría** con la
fecha, el correo y el motivo del borrado — sin identificador de usuario, sin
contenido y sin credenciales — porque es la prueba de que se atendió la petición y
de que no se ha seguido tratando el dato. Es la única excepción al borrado total y
se documenta aquí de forma expresa.

Las copias de seguridad se conservan (comprimidas y con acceso restringido) el
periodo de retención pactado y se purgan solas al caducar; una copia antigua puede
contener datos ya borrados, por lo que **no se restauran copias con más de 90 días**
ni se usan para finalidades distintas de la recuperación ante desastres.

### 6. Fin del contrato: devolución y supresión

Al terminar, el Encargado permite al Responsable **exportar** sus datos (CSV/JSON) durante
**30 días naturales**. Después, se suprimen de los sistemas activos y de las copias de
seguridad en un plazo máximo de **90 días naturales**, salvo obligación legal de
conservación `[p. ej. facturación: 4 años]`.

### 7. Responsabilidad

Cada parte responde de sus propios incumplimientos conforme al RGPD. El Encargado responde
de los daños que cause por tratar los datos fuera de las instrucciones, por no aplicar las
medidas de seguridad o por avisar tarde de una brecha.

### 8. Ley aplicable

Ley española. Jurisdicción de `[CIUDAD]`. Las partes intentarán resolver cualquier
controversia por acuerdo antes de acudir a los tribunales.

**Firmado** en `[LUGAR]`, a `[FECHA]`:

- El Encargado: `[NOMBRE]` — `[CARGO/FIRMA]`
- El Responsable: `[NOMBRE]` — `[CARGO/FIRMA]`

---

## ANEXO I — Medidas de seguridad aplicadas

Lo que ya hace la plataforma (puedes citarlo tal cual):

| Medida | Detalle |
|---|---|
| Cifrado en tránsito | HTTPS obligatorio (certificado renovado automáticamente) |
| Cifrado en reposo de credenciales | Tokens de tiendas y claves de proveedores cifrados con AES-256-GCM |
| Aislamiento por cliente | Cada cliente solo puede acceder a sus propios datos (capa de aislamiento verificada con pruebas, incluidas las que intentan leer datos de otro cliente) |
| Control de acceso | Autenticación con contraseña (hash reforzado), sesiones firmadas y **doble factor (TOTP)** opcional para el cliente |
| Registro de auditoría | Altas, accesos, cambios de plan, conexiones de tiendas y pruebas de credenciales quedan registrados |
| Copias de seguridad | Diarias y con **restauración verificada** |
| Borrado de datos | Procedimiento documentado al terminar la relación |
| Minimización | Solo se guardan los datos necesarios para gestionar el pedido |

## ANEXO II — Subencargados autorizados

| Subencargado | Servicio | Ubicación |
|---|---|---|
| `[PROVEEDOR DE SERVIDOR: p. ej. Hetzner / AWS / OVH]` | Alojamiento de la plataforma | `[UE]` |
| `[RESEND u otro]` | Envío de correo transaccional y avisos | `[EE. UU. con Cláusulas Contractuales Tipo]` |
| Shopify Inc. / Automattic Inc. | Plataforma de tienda del **propio Responsable** (no es subencargado del Encargado: el Responsable ya tiene su contrato con ellos) | — |
| `[STRIPE / LEMON SQUEEZY]` | Cobro de la suscripción del Responsable (no trata datos de sus compradores) | `[UE / EE. UU. con garantías]` |
| `[PROVEEDOR DE PROXIES]` | Extracción de catálogo (si aplica) | `[UE]` |

> Si usas transferencias internacionales, indica el mecanismo (decisión de adecuación o
> Cláusulas Contractuales Tipo). Mantén este anexo actualizado: es lo que el cliente
> revisará primero.

---

## Cómo usarlo en la práctica

1. **Rellena** tus datos y los de tus subencargados reales (revisa el ANEXO II cada vez que
   cambies de proveedor de servidor o correo).
2. **Pásalo a revisión** de un abogado o de un servicio de suscripción legal (~50–150 €
   una vez).
3. **Añádelo a tu web** como página pública enlazada desde los términos y desde el panel
   (ayuda a cerrar ventas: los clientes lo piden en su primer correo).
4. **Fírmalo** con cada cliente al darle de alta (vale una firma electrónica simple, por
   ejemplo con la respuesta «De acuerdo» a un correo con el documento adjunto y su hash).
5. **Las páginas legales** del panel (`/privacy`, `/terms`, `/cookies`) siguen siendo
   plantillas con `[CORCHETES]`: rellénalas con los mismos datos.
