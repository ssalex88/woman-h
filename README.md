# VERA

Base funcional para desarrollo con **datos exclusivamente ficticios**. Incluye React + TypeScript + Vite, FastAPI, PostgreSQL, migraciones Alembic y autenticación mediante sesiones persistentes y revocables. Toda la interfaz de producto está en español.

Esta entrega permite iniciar/cerrar sesión, comenzar a contar lo ocurrido desde Inicio (HU-04), crear, listar, consultar y editar registros privados (HU-01), añadir y editar relatos de hechos (HU-02) y cargar archivos privados vinculados a esos relatos (HU-03). Se conserva el contexto institucional básico existente. No incluye expedientes, reportes, envíos ni IA. Las pantallas explican este alcance; no muestran operaciones simuladas como implementadas.

## Ejecución local

Requisitos: Python 3.12 o superior, Node 22.12 o superior y Docker Compose (o una instalación de PostgreSQL 17/18). Ejecutar desde la raíz. Los comandos siguientes usan PowerShell.

```powershell
Copy-Item .env.example .env
Copy-Item frontend/.env.example frontend/.env
docker compose up -d --wait db
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
Set-Location backend
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m app.seed
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

En una segunda terminal, desde la raíz:

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Abrir **http://localhost:5173**. Mantener este nombre de host: `127.0.0.1:5173` es un origen distinto y no está autorizado por defecto. La API sirve documentación técnica en http://127.0.0.1:8000/api/docs y estado de conexión en `/api/health`.

En macOS/Linux: sustituir `.venv\Scripts\python.exe` por `.venv/bin/python`, `Copy-Item` por `cp`, `Set-Location` por `cd` y `npm.cmd` por `npm`.

Con PostgreSQL ya instalado, crear una base y un usuario exclusivos para VERA y adaptar `DATABASE_URL` en `.env`; omitir Docker. El esquema se crea únicamente con Alembic, no al iniciar el servidor. `docker compose down` conserva los datos en el volumen `vera_db`.

## Cuentas ficticias

Todas usan el valor de `DEMO_PASSWORD` de `.env`; el ejemplo es `Vera-Ficticia-2026!`.

| Correo | Acceso institucional | Espacio privado |
| --- | --- | --- |
| ana@example.test | Ninguno | Solo el propio |
| bea@example.test | Ninguno | Solo el propio |
| revisora@example.test | Revisión en Aurora | Solo el propio |
| admin@example.test | Administración en Aurora | Solo el propio |
| otra@example.test | Revisión en Brisa | Solo el propio |

Aurora y Brisa son instituciones ficticias. El rol se guarda en la membresía de cada institución, no en el navegador. `python -m app.seed` es explícito e idempotente: no se ejecuta al arrancar ni cambia contraseñas, membresías o cuentas ya existentes. Cambiar `DEMO_PASSWORD` no modifica usuarios previamente creados. El comando rechaza producción o demostración desactivada.

Para comprobarlo visualmente, entrar con Ana, cerrar sesión y entrar con Bea: cada cuenta tiene un contexto personal distinto. Entrar como administradora muestra además Aurora, pero no Brisa ni información de otras personas. Las pruebas de API comprueban también intentos directos de eludir la interfaz.

## Configuración

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión `postgresql+psycopg://...`; obligatoria |
| `APP_ENV` | `development`, `test` o `production` |
| `ALLOWED_ORIGINS` | Lista JSON de orígenes explícitos para CORS y protección CSRF |
| `COOKIE_SECURE` | `false` solo para desarrollo HTTP; `true` para HTTPS |
| `SESSION_HOURS` | Duración absoluta de sesión, entre 1 y 24 horas; defecto 8 |
| `DEMO_ENABLED` | Habilita la carga ficticia y el indicador de demostración |
| `DEMO_PASSWORD` | Contraseña de carga inicial; mínimo 16 caracteres |
| `POSTGRES_*` | Configuración del contenedor local |
| `API_PROXY_TARGET` | En `frontend/.env`: destino del proxy de Vite; sin credenciales |

No hay secretos ni tokens de sesión en variables `VITE_*`, localStorage o respuestas JSON. La configuración de producción exige cookies seguras, orígenes HTTPS y demostración desactivada. No existe una clave JWT: las sesiones son tokens aleatorios y la base solo almacena su SHA-256.

HU-04 conserva el texto aún no enviado mediante `sessionStorage`, separado por cuenta y pestaña. No contiene credenciales. Esta copia de recuperación se elimina al continuar correctamente o cerrar sesión; sus límites se explican en la sección de Inicio.

## Autenticación y autorización

Contraseñas protegidas con Argon2id. Cookie `HttpOnly`, `SameSite=Strict`, limitada a `/api`, con expiración y `Secure` configurable. Cerrar sesión elimina la sesión del servidor; iniciar una nueva sesión desde el mismo navegador revoca la anterior. Cada solicitud verifica expiración, usuario activo y permisos actuales en PostgreSQL; revocar una membresía tiene efecto inmediato. Las respuestas de la API usan `Cache-Control: no-store`.

Las escrituras requieren tanto un `Origin` autorizado como `X-VERA-Request: 1`. Este encabezado no es una credencial: obliga a una preflight de CORS en solicitudes desde otro origen. El backend valida ambos incluso en inicio/cierre de sesión y creación/edición de registros. Clientes de pruebas o documentación deben enviarlos explícitamente.

| Endpoint | Regla del backend |
| --- | --- |
| `POST /api/auth/login` | Credenciales válidas y usuario activo |
| `POST /api/auth/logout` | Revoca la cookie recibida; operación idempotente |
| `GET /api/auth/me` | Sesión vigente; solo identidad y membresías propias |
| `GET /api/private/{owner_id}/context` | Sesión vigente y coincidencia exacta con la persona propietaria |
| `GET /api/institutions/{institution_id}/context` | Membresía vigente en esa institución |
| `GET /api/health` | Público; verifica conexión, no expone identidades |
| `POST /api/records` | Crea un borrador privado para la persona autenticada |
| `GET /api/records` | Lista únicamente registros propios, del más reciente al más antiguo |
| `GET /api/records/{id}` | Detalle exclusivamente para el propietario |
| `PUT /api/records/{id}` | Modifica título y descripción exclusivamente para el propietario |
| `GET /api/records/{id}/accounts` | Lista relatos del registro, solo para su propietario |
| `POST /api/records/{id}/accounts` | Añade un relato al registro propio |
| `GET /api/records/{id}/accounts/{relato_id}` | Consulta un relato del registro propio |
| `PUT /api/records/{id}/accounts/{relato_id}` | Edita un relato sin cambiar registro ni fecha de registro |

Un administrador tiene únicamente acceso al contexto de su institución en esta etapa. `case_access: false` es una declaración del alcance actual, no una autorización calculada sobre expedientes existentes: no existen tablas ni endpoints de expedientes todavía. Ningún rol permite leer espacios privados ajenos. Los endpoints de contexto no contienen relatos o archivos.

En un despliegue futuro, servir el frontend y `/api` bajo el mismo origen HTTPS mediante un proxy inverso. El proxy de Vite es solo de desarrollo; `vite preview` no sustituye ese despliegue.

## Pruebas y compilación

Pruebas rápidas del backend (SQLite temporal exclusivo para pruebas):

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m pytest -q
```

Pruebas completas con PostgreSQL, usando una base **desechable** y separada cuyo nombre termine en `_test`:

```powershell
# Crear vera_test previamente con el usuario de pruebas.
$env:TEST_DATABASE_URL='postgresql+psycopg://vera:vera_local_only@localhost:5432/vera_test'
..\.venv\Scripts\python.exe -m pytest -q
Remove-Item Env:TEST_DATABASE_URL
```

Las pruebas limpian las tablas de la base de pruebas. No usar una base con datos que quieras conservar. Ejecutan la migración real, `alembic check`, reversión y reaplicación; cubren aislamiento entre personas e instituciones, administradores sin privilegios implícitos, revocación, expiración, manipulación de roles, CSRF y carga ficticia idempotente. `.github/workflows/checks.yml` prepara PostgreSQL 17 para ejecutarlas en CI.

Desde `frontend`:

```powershell
npm.cmd test
npm.cmd run build
```

Las pruebas de componentes usan respuestas controladas únicamente dentro de los tests; la aplicación usa siempre la API real. `package-lock.json` y `backend/requirements.lock.txt` fijan dependencias reproducibles. `requirements.txt` declara las dependencias directas.

La suite incluye pruebas de aislamiento y validación de HU-01, además de las pruebas de autenticación. CI está configurado, pero no se ejecutó en GitHub. Starlette emite una advertencia de deprecación de su integración con `httpx` en pruebas; no afecta a los resultados.

## HU-01: registros privados

Para actualizar una instalación existente, ejecutar desde `backend`:

```powershell
..\.venv\Scripts\python.exe -m alembic upgrade head
```

La migración `0002` agrega `private_records` sin alterar usuarios ni membresías existentes. Reiniciar la API y ejecutar `npm.cmd ci` desde `frontend` para instalar también las dependencias de pruebas actualizadas.

En **VERA Private → Mis registros → Nuevo registro**, completar título (1–200 caracteres) y descripción inicial (1–10 000 caracteres). Ambos son obligatorios y se rechazan valores compuestos solo por espacios. Al guardar se abre el detalle; desde allí se puede editar o volver a la lista. La información persiste al recargar e iniciar sesión nuevamente. La interfaz incluye estados de carga, vacío, guardado y error, reintento de consultas y conservación de campos ante un fallo al guardar.

El backend fija propietario, estado `private_draft` (mostrado como **Borrador privado**) y fechas UTC; el cliente no puede elegir propietario, institución o estado. Tanto POST como PUT aceptan exclusivamente `{ "title": "Título ficticio", "description": "Descripción ficticia" }`. PUT requiere ambos campos. Los IDs ajenos e inexistentes devuelven el mismo 404, también para administradores institucionales. Crear o editar no genera reportes, expedientes ni envíos institucionales. La lista se filtra por sesión y no acepta cambiar de propietario mediante parámetros.

Prueba reproducible del recorrido completo con API, PostgreSQL y frontend en ejecución y usuarios ficticios cargados (desde `frontend`):

```powershell
npm.cmd run test:e2e
```

En Windows utiliza Edge instalado. En Linux/macOS ejecutar antes `npx playwright install chromium`. Si cambiaste la contraseña ficticia inicial, configurar `DEMO_PASSWORD` en la terminal de las pruebas. El test crea un registro ficticio con título único y lo conserva en la base de demostración; usar exclusivamente un entorno de desarrollo. Verifica creación, persistencia después de recargar, edición, aislamiento de lista y acceso directo GET/PUT como Bea y como administradora, y vista móvil.

Límites de HU-01: sin borrado, paginación o historial de versiones. Los adjuntos se incorporan en HU-03. Las ediciones simultáneas conservan la última escritura. El detalle se abre desde la lista; el ID no constituye una autorización de acceso.

Verificación de HU-01 realizada: 42 pruebas del backend aprobadas en PostgreSQL 18 y SQLite temporal, 6 pruebas de componentes, compilación TypeScript/Vite y 1 prueba de recorrido completo con Edge, FastAPI y PostgreSQL reales.

## Límites de esta entrega y siguientes HU

HU-02 se documenta a continuación; mantiene todos los límites de acceso de los registros privados.

La base es para desarrollo, no un servicio listo para recibir información real. Recuperación de contraseña, alta de usuarios, MFA, límites de intentos de acceso y auditoría operativa están pendientes. Los usuarios se crean con el comando de demostración. No se ha desplegado el servicio.

Las siguientes HU deberán conservar estas reglas: acceso institucional solo a lo enviado explícitamente; selección y copias inmutables al enviar; originales separados de extracción y análisis; permisos de expediente explícitos, sin acceso automático por ser administrador. La IA propondrá eventos y resúmenes con fuentes verificables y nunca determinará culpabilidad, credibilidad o sanciones. El contenido de archivos será tratado como datos y nunca como instrucciones. Esta tarea no necesita una API ni un adaptador de IA: se incorporarán con la HU correspondiente y se identificará cualquier modo demostración.

## HU-02: relatos de hechos

Aplicar `python -m alembic upgrade head` desde `backend` usando el entorno virtual y reiniciar la API. La migración `0003` añade relatos (tabla `accounts`) relacionados con `private_records`; conserva los registros existentes. No se requiere ninguna dependencia nueva.

Desde el detalle de un registro, usar **Relatos de hechos → Añadir relato**. Solo se exige descripción (1–10 000 caracteres) y elegir la precisión de la fecha; el formulario comienza con **Desconocida** y lo indica expresamente. No se necesitan archivos.

| Precisión | Almacenamiento y presentación |
| --- | --- |
| Exacta | `date_kind: "exact"` y `event_date: "2025-03-14"`; fecha de calendario sin hora ni conversión de zona |
| Aproximada | `date_kind: "approximate"` y `approximate_date: "A mediados de marzo de 2025"`; conserva la referencia textual, sin inferir un día |
| Desconocida | `date_kind: "unknown"`; ambas fechas quedan en `null` |

Se muestran etiquetas textuales **Fecha exacta**, **Fecha aproximada** o **Fecha desconocida**, además de la referencia aportada. No se depende solo del color. Lugar (hasta 500 caracteres) y personas mencionadas (hasta 2000 caracteres) son texto opcional: si quedan vacíos o solo contienen espacios, se guardan como `null` y se presentan como «No indicado» / «No indicadas». No hay extracción, identificación automática ni inferencia de personas o lugares.

`created_at` es la fecha de registro automática del servidor en UTC; se presenta separada de la fecha del hecho y no cambia al editar. `updated_at` registra la última modificación. El cliente no puede asignar estos campos, cambiar el registro padre ni atribuirse la propiedad. Todos los endpoints verifican al propietario del registro y la correspondencia entre relato y registro; los roles institucionales no conceden acceso. No se generan reportes ni envíos.

POST y PUT reciben la descripción, `date_kind` y los campos opcionales. Ejemplo mínimo válido, sin fecha exacta ni archivos:

```json
{ "description": "Descripción de un hecho ficticio", "date_kind": "unknown" }
```

PUT reemplaza los campos editables: omitir un opcional lo deja en `null`. Al cambiar de precisión, el frontend envía `null` para los campos de fecha que ya no corresponden; la API rechaza combinaciones contradictorias y fechas de calendario inválidas. La base también exige coherencia entre precisión y campos de fecha.

Usar **Editar relato** para modificar descripción, precisión, fecha, lugar o personas. La lista se ordena por fecha de registro, no por una fecha del hecho inferida. Se mantienen estados de carga, vacío y error, reintento de consulta y conservación de lo escrito ante un fallo al guardar. Sin borrado, historial de versiones ni resolución de ediciones simultáneas; prevalece la última escritura.

Las mismas instrucciones de pruebas aplican: `python -m pytest -q`, `npm.cmd test`, `npm.cmd run build` y, con API/DB/frontend en ejecución, `npm.cmd run test:e2e`. La prueba de HU-02 crea relatos ficticios con los tres tipos de fecha, recarga, edita y prueba el rechazo directo de otra persona y una administradora en la API. Los relatos de demostración permanecen en la base de desarrollo.

Verificación de HU-02: 67 pruebas backend aprobadas con PostgreSQL 18, 9 pruebas de interfaz, compilación TypeScript/Vite y ambos recorridos de navegador (HU-01 y HU-02) aprobados contra FastAPI y PostgreSQL reales.

## HU-03: archivos privados

Para actualizar una instalación existente, desde la raíz:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
Set-Location backend
..\.venv\Scripts\python.exe -m alembic upgrade head
```

Reiniciar la API con el comando habitual de Uvicorn. La migración `0004` añade metadatos de archivos y vínculos a relatos, sin alterar registros existentes. Las nuevas variables tienen valores locales predeterminados: no es necesario configurar Supabase ni otros servicios.

En el detalle de un registro, usar **Archivos privados → Añadir archivo**. Se admite un archivo por carga: captura PNG, foto JPEG/WebP o PDF. La descripción es opcional (hasta 2000 caracteres). Se puede seleccionar hasta 50 relatos del mismo registro; estos son los eventos disponibles actualmente. Si todavía no hay relatos, cargar sin vínculos y usar **Editar vínculos** después. También se puede editar la descripción y retirar vínculos sin alterar el original.

**Ver vista previa** muestra un PNG derivado; para PDF, únicamente la primera página. **Descargar original** recupera exactamente los bytes cargados. La vista previa no conserva metadatos EXIF y nunca reemplaza el original. No se extrae texto ni se genera análisis; el contenido se trata exclusivamente como datos. Los estados de carga, vacío, formato inválido, exceso de tamaño y error de almacenamiento se muestran en español.

| Variable | Predeterminado y función |
| --- | --- |
| `STORAGE_FACTORY` | `app.storage:LocalStorage`; factoría confiable del servidor que recibe `Settings` |
| `STORAGE_ROOT` | `.private-storage`, relativa a la raíz del proyecto, independientemente del directorio de ejecución |
| `MAX_UPLOAD_BYTES` | `10485760`: 10 MiB por archivo |
| `MAX_IMAGE_PIXELS` | `25000000`: límite de píxeles antes de decodificar la imagen |
| `MAX_PDF_PAGES` | `200`: máximo de páginas; PDF vacíos o cifrados se rechazan |

El tamaño se verifica sobre los bytes recibidos, no solo sobre `Content-Length`; el cuerpo multipart tiene un margen acotado de 64 KiB para campos y delimitadores. Pillow verifica y decodifica imágenes; pypdf valida la estructura del PDF y PDFium renderiza la primera página. Se rechazan archivos vacíos, dañados, formatos no admitidos y extensiones que no coincidan con el formato detectado. El MIME enviado por el cliente no determina el formato aceptado. No se admiten SVG, HEIC ni documentos de Office.

Los originales se guardan bajo `originals/<clave aleatoria>` y las vistas previas bajo `previews/<clave aleatoria>`. El nombre aportado por el usuario solo es una etiqueta normalizada; nunca construye rutas. Las claves tienen formato estricto y las rutas resueltas deben permanecer dentro de la raíz configurada. `.private-storage` se excluye del repositorio y del servidor de archivos de Vite. No ubicar esa carpeta en un directorio publicado por otro servidor. Conservar juntos una copia de PostgreSQL y otra del almacenamiento para respaldar la demostración.

`PrivateStorage` define `put(key, bytes)`, `read(key)` y `delete(key)`. La factoría se configura mediante una ruta `modulo:Clase`; los endpoints no dependen del disco ni devuelven URLs del proveedor. Para un futuro adaptador Supabase, implementar ese contrato con un bucket privado, credenciales solo en el backend y errores de escritura sin objetos parciales. Migrar los objetos conservando sus claves antes de cambiar la factoría. El adaptador externo y el despliegue quedan pendientes; la ejecución actual es totalmente local. Los tests también comprueban el contrato con un almacenamiento en memoria, usado exclusivamente como doble de prueba.

| Endpoint bajo `/api/records/{registro_id}/files` | Comportamiento |
| --- | --- |
| `GET /` (sin barra final) | Lista metadatos y límites; sin claves internas ni URLs públicas |
| `POST /` (sin barra final) | Multipart con `file`, `description` opcional y `account_ids` como array JSON opcional |
| `GET /{archivo_id}` | Metadatos del archivo |
| `PUT /{archivo_id}` | JSON con descripción y lista de relatos; omitirlos los vacía |
| `GET /{archivo_id}/content` | Original como adjunto, tras verificar sesión y propiedad |
| `GET /{archivo_id}/preview` | PNG derivado, con la misma autorización |

Todas las rutas verifican al propietario del registro y la pertenencia del archivo a ese registro. También verifican que los relatos vinculados pertenezcan al mismo registro. Otra persona o una administradora recibe 404; sin sesión se recibe 401. Las respuestas usan `no-store` y `nosniff`. Las URLs de la API requieren autorización cada vez; no hay enlaces públicos permanentes, redirecciones a buckets ni montaje estático de los originales. El navegador usa URLs `blob:` temporales para presentar o descargar los bytes ya autorizados, y las libera al terminar.

Se conserva un SHA-256 del original. Si falla la escritura o la transacción, se revierten los metadatos y se intenta retirar los objetos escritos; los fallos de limpieza se registran en el backend. Un cierre abrupto del proceso puede dejar objetos huérfanos que requieran reconciliación futura.

Pruebas: `python -m pytest -q` desde `backend`, y `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:e2e` desde `frontend`. Para las pruebas de navegador, mantener PostgreSQL, API y Vite en ejecución. Los fixtures de `frontend/e2e/fixtures` son imágenes y un PDF ficticios. La prueba carga PNG, JPEG y PDF, valida las vistas previas, compara las descargas byte por byte, conserva vínculos al recargar y prueba accesos ajenos. No usa servicios externos.

Alcance: sin OCR, análisis, envíos institucionales, borrado ni antivirus. La validación de formato no equivale a detectar malware; el procesamiento de archivos aún no se ejecuta en procesos aislados con límites de CPU. Se mantiene el uso exclusivo de datos ficticios en desarrollo.

Verificación de HU-03 completada: 89 pruebas backend aprobadas con PostgreSQL 18 (22 específicas de archivos), 12 pruebas de interfaz, compilación TypeScript/Vite y los tres recorridos de navegador HU-01/HU-02/HU-03. También se comprobó el bloqueo de acceso directo a los originales por Vite y la presentación móvil del panel. Los servicios locales quedaron disponibles para revisión; no se configuraron ni desplegaron servicios externos.

## HU-04: Inicio para contar lo ocurrido

Actualizar con `python -m alembic upgrade head` desde `backend` usando el entorno virtual y reiniciar la API. La migración `0005` añade solo referencias para reconocer reintentos; el texto definitivo se guarda en las tablas de registros y relatos ya existentes. No hay dependencias nuevas ni servicios externos que configurar.

Tras iniciar sesión se abre **Inicio**, con una invitación para contar lo ocurrido, un área de texto, **Continuar** y los tres registros propios más recientes. **Mis registros** abre el flujo original de HU-01. **Retomar** abre el detalle existente con sus relatos y archivos; desde allí siguen disponibles las ediciones de HU-01/HU-02 y las cargas de HU-03. El contexto institucional previo se conserva para sus usuarios, sin añadir un panel nuevo.

No se pide título ni fecha en Inicio. Continuar crea un registro privado titulado provisionalmente **Mi registro** y su primer relato con fecha **Desconocida**, lugar y personas vacíos. El título se puede cambiar desde **Editar registro** y los datos del hecho desde **Editar relato**. No se genera ningún reporte ni envío institucional.

`POST /api/start` recibe `{ "entry_id": "UUID de reintento", "text": "Relato ficticio" }`. Reutiliza las funciones compartidas de creación/edición de registros y relatos en una sola transacción. Si falla una parte, se revierte todo. En PostgreSQL las solicitudes de una misma persona se serializan; repetir la clave no duplica el registro o el relato. Una clave repetida con texto distinto actualiza los mismos objetos y conserva el título y los datos opcionales del relato. Las claves son independientes por usuario y nunca autorizan el acceso a información de otra persona. No se aceptan IDs de propietarios o de registros elegidos por el cliente.

El borrador se conserva en esta pestaña mientras se escribe, incluso al navegar o recargar. **Todavía no está en PostgreSQL hasta pulsar Continuar**. Se elimina después de una confirmación exitosa o al cerrar sesión. Cerrar la pestaña, borrar los datos del navegador o cambiar de navegador/dispositivo puede perder el texto pendiente. Si `sessionStorage` está bloqueado o lleno, la interfaz lo informa; el texto sigue disponible en memoria durante esa sesión de la pantalla. Se recomienda usar únicamente datos ficticios, como en el resto del desarrollo.

Si falla Continuar, se conserva el texto y la misma clave para volver a intentar. Esto incluye la pérdida de la respuesta cuando el servidor ya guardó la transacción. Al volver a Inicio después de guardar, el editor permite empezar otro registro y el anterior aparece en recientes para retomarlo. No hay autosincronización de borradores entre dispositivos ni historial de versiones.

### Pantallas para revisar la UX

1. **http://localhost:5173/#/inicio**: entrar como `ana@example.test` con `Vera-Ficticia-2026!`. Escribir un texto ficticio sin título ni fecha.
2. Abrir **Mis registros**, volver a **Inicio** y recargar: comprobar que el texto pendiente sigue allí.
3. Pulsar **Continuar**: se abre `#/registros/<id>` con el texto en el registro y en el relato. Verificar que la fecha del hecho aparece como desconocida y que siguen funcionando editar relato y añadir archivo.
4. Volver a **Inicio → Retomar**: abre el mismo registro. **Ver todos** lleva a `#/registros`; **Nuevo registro** conserva el formulario anterior.
5. Cerrar sesión y entrar como `bea@example.test`: comprobar que no se muestran los registros ni el borrador de Ana.

Las rutas usan fragmentos (`#/...`), compatibles con la ejecución local y un futuro alojamiento estático sin configurar reglas de redirección. Recargar el detalle conserva la ruta y vuelve a comprobar permisos en el backend.

Las pruebas `frontend/e2e/home.spec.ts` ejercitan el flujo real con PostgreSQL, recuperación tras recarga, reintento después de perder una respuesta, detalle, recientes y aislamiento. Una segunda prueba inyecta exclusivamente en Playwright respuestas de carga, error y lista vacía para revisar esos estados sin alterar datos de la demostración. Las capturas de escritorio/móvil se guardan en `frontend/test-results`; no existe un modo simulado añadido al producto.

Verificación de HU-04: 96 pruebas backend aprobadas con PostgreSQL (incluye reintentos concurrentes y reversión de una operación incompleta), 16 pruebas de interfaz, compilación TypeScript/Vite y 5 recorridos de navegador aprobados entre las cuatro HU. Se revisaron visualmente las capturas de Inicio con registros, vacío, carga y error, además de las vistas móviles. Los servicios siguen disponibles en local; no se desplegó a servicios externos.

## HU-05: contar por voz y revisar el texto

Inicio permite elegir **Escribir** o **Contarlo por voz**. No requiere nuevas dependencias, migraciones ni claves. Reiniciar el backend y ejecutar el frontend con las instrucciones anteriores. La voz usa el reconocimiento nativo del navegador, encapsulado en `frontend/src/speech.ts`; no hay transcripciones ficticias en el producto.

Se evaluaron estas opciones antes de implementar:

| Opción | Evaluación para esta demo |
| --- | --- |
| Web Speech / SpeechRecognition | Elegida como entrada opcional: integra voz sin servicios propios ni claves. Su compatibilidad y servicio de reconocimiento son variables; escribir siempre está disponible. |
| MediaRecorder + transcripción en servidor | Permitiría elegir un proveedor más predecible, pero requiere una API, credenciales y manejo temporal de audio. No se configura un servicio externo en esta HU. |
| Modelo local en navegador o backend | Evitaría un proveedor remoto, pero exige descargar modelos, recursos de procesamiento y comprobar rendimiento por dispositivo. No es la opción más sencilla para esta base. |

**La voz no está garantizada en todos los navegadores ni sin conexión.** La existencia de `SpeechRecognition` o `webkitSpeechRecognition` no asegura que el proveedor funcione. Se requiere un contexto seguro: `localhost` durante desarrollo y HTTPS al publicar. El idioma solicitado es español de Perú (`es-PE`); el soporte efectivo depende del navegador. [MDN documenta la disponibilidad limitada](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) y el [posible procesamiento remoto del audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API).

VERA no recibe ni almacena archivos de audio: no hay subida, enlace ni endpoint de audio añadido. El navegador puede enviar la voz a su proveedor; VERA no controla sus políticas de conservación. Esta información aparece antes de iniciar. La transcripción queda como borrador en esta pestaña, con el mismo aislamiento por usuario y recuperación de HU-04. Solo al revisar y pulsar Continuar se guarda en PostgreSQL como registro y relato privados. La institución no recibe audio ni texto y conserva las restricciones de acceso existentes.

Cada captura dura hasta dos minutos. Se muestran espera de permiso, micrófono activo y finalización de transcripción. Se liberan los recursos al salir de la pantalla; al ocultar la pestaña se solicita detener. Hay límites de espera de 20 segundos al iniciar y 8 al finalizar. El texto ya escrito se conserva y cada captura nueva se añade al final. Si se alcanza el límite de 10 000 caracteres, se detiene y se avisa explícitamente del texto excedente que no se añadió.

Los resultados provisionales también pueden aparecer en el editor, siempre pendientes de revisión. Al detener, se puede corregir el texto y marcar **He revisado y corregido el texto.** Continuar permanece bloqueado hasta hacerlo. Modificar el texto, recibir otra transcripción o volver a la pantalla requiere revisar otra vez. Nunca se continúa automáticamente. `POST /api/start` recibe además `source: "voice"` y `reviewed: true`; una solicitud declarada como voz sin confirmación se rechaza antes de crear datos. Esta confirmación es una declaración de la persona, no una validación de exactitud ni una prueba de que haya leído. El flujo por texto sigue siendo compatible con HU-04.

### Cómo probar en tu navegador

1. Abre **http://localhost:5173/#/inicio** e ingresa con `ana@example.test` / `Vera-Ficticia-2026!`.
2. Selecciona **Contarlo por voz → Iniciar voz**, permite el micrófono y pronuncia una situación ficticia. Usa un navegador que ofrezca reconocimiento de voz y comprueba su funcionamiento antes del pitch.
3. Pulsa **Detener y revisar**, corrige el texto, marca la confirmación y pulsa **Continuar**. Se abre el detalle del registro con su relato; Inicio permite retomarlo desde recientes.
4. Para comprobar el rechazo del permiso, bloquea el micrófono desde los permisos del sitio en el navegador y vuelve a iniciar voz. **Seguir escribiendo** conserva el avance. Después puedes restablecer el permiso desde ese mismo menú.
5. Si no aparece texto o falla el servicio, usa **Seguir escribiendo**. No es necesario reiniciar el registro ni proporcionar audio a VERA.

Verificación de HU-05: 97 pruebas backend con PostgreSQL, 22 pruebas de interfaz y 8 recorridos Playwright aprobados, incluidos HU-01 a HU-04. Se verificaron captura/finalización, edición, revisión obligatoria, recuperación del borrador, rechazo de micrófono, servicio sin respuesta, error de red, navegador incompatible y guardado con API/PostgreSQL reales. Se revisaron capturas de escritorio y móvil. Las pruebas automatizadas de voz usan un doble de SpeechRecognition **solo dentro de los tests**: no prueban precisión ni disponibilidad del proveedor.

La comprobación adicional con Chrome nativo en modo automatizado y un WAV ficticio encontró la API disponible, pero terminó sin obtener texto; la alternativa escrita funcionó. Por tanto, **no se ha validado una transcripción real exitosa en este entorno**. La prueba manual con micrófono sigue siendo necesaria para la máquina y el navegador del pitch. No se desplegó ni configuró ningún servicio externo.

## HU-06: archivos opcionales después del relato

Después de Continuar en Inicio (texto o voz revisada), se abre `#/registros/<id>/archivos` con **¿Tienes algún archivo relacionado con lo ocurrido?** y **No es obligatorio. Puedes añadirlo ahora o más adelante.** El relato ya está guardado. No hay otra copia del registro ni un segundo sistema de cargas: se reutilizan `Files`, los endpoints y la abstracción privada de HU-03.

Puedes añadir, describir, vincular a relatos, previsualizar y descargar capturas, fotos o PDF. Se conservan formatos, validación real y límites de HU-03. **Continuar sin archivos** abre el detalle existente; cuando hay archivos, la acción se llama **Continuar con archivos**. Ante un error al listar, **Continuar al registro** permite salir del paso opcional sin afirmar que no hay archivos.

**Volver al relato** abre `#/registros/<id>/relato` y reutiliza la edición de HU-02. Guarda o cancela la edición antes de volver a los archivos. Los archivos ya cargados permanecen asociados al mismo registro. Las acciones del paso se deshabilitan mientras el formulario de archivo está abierto o se está quitando uno, para evitar abandonar una selección pendiente. Recargar recupera el relato y archivos ya guardados; los cambios sin guardar de los formularios de HU-02/HU-03 no tienen recuperación automática.

**Quitar archivo** solicita confirmación en la propia pantalla. `DELETE /api/records/{id}/files/{file_id}` verifica propietario y pertenencia al registro, elimina metadatos y vínculos, y limpia original y vista previa mediante `PrivateStorage.delete`. No modifica el relato. Sin sesión responde 401; otra persona, administrador institucional o registro incorrecto recibe 404. Los endpoints de contenido y vista previa dejan de servir un archivo quitado.

La revocación en PostgreSQL se confirma antes de borrar los objetos. Si falla la limpieza física o el proceso se interrumpe, pueden quedar objetos privados huérfanos, inaccesibles desde la API. Los fallos de limpieza registran su clave interna en el log del servidor para reconciliación operativa; no hay una cola automática de reintentos. El botón confirma la retirada del registro, no una garantía de borrado de copias de respaldo. Esta limitación es relevante para un futuro almacenamiento externo.

No hay migraciones, variables nuevas ni servicios externos. Reiniciar la API y ejecutar Vite como en las instrucciones iniciales. HU-01 a HU-05 conservan sus componentes y permisos; el único cambio intencionado del recorrido anterior es este paso intermedio antes del detalle. No se generan reportes ni se realiza extracción o análisis.

### Punto de revisión manual

1. Abre **http://localhost:5173/#/inicio** e ingresa con `ana@example.test` / `Vera-Ficticia-2026!`.
2. Escribe un relato ficticio y pulsa **Continuar** (o usa voz y confirma la revisión).
3. **Detente en la pantalla «¿Tienes algún archivo relacionado con lo ocurrido?»**, antes de pulsar Continuar sin/con archivos. Es el paso de HU-06.
4. Prueba añadir `frontend/e2e/fixtures/captura.png`, abrir su vista previa y volver al relato. Guarda una corrección y regresa: el archivo sigue allí.
5. Prueba quitarlo, cancelar la confirmación y luego confirmar. Puedes continuar sin archivos o cargar otro. Al continuar llegarás al detalle de siempre.

Verificación: 99 pruebas backend con PostgreSQL, 22 pruebas de interfaz, compilación TypeScript/Vite y los 10 recorridos de navegador aprobados (los dos de HU-06 se repitieron tras corregir una espera en el test). Se cubren eliminación de original/vista previa/vínculos, conservación del relato, aislamiento por propietario y fallo del almacenamiento; recorrido desde Inicio con y sin archivos, regreso al relato, recarga, vista previa, confirmación, errores de carga/eliminación y acceso ajeno por interfaz/API. Los fallos artificiales se inyectan solo en tests. Se revisaron las capturas de escritorio y móvil, disponibles en `frontend/test-results`.

Referencias técnicas: [Vite](https://vite.dev/guide/), [Alembic](https://alembic.sqlalchemy.org/en/latest/tutorial.html) y [seguridad de FastAPI](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/). La implementación usa sesiones opacas en lugar de JWT para permitir revocación inmediata.
