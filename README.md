# Haze Vault

Haze Vault es una app web local para administrar archivos de un NAS desde el
navegador. Esta pensada para correr dentro de la red local y trabajar directo
contra carpetas del sistema de archivos configuradas por el administrador.

![Vista previa de Haze Vault](docs/assets/haze-vault-preview.png)

## Funciones

- Papelera por almacenamiento en `.haze-trash`, con restaurar y borrar definitivo.
- Busqueda, filtros por tipo y orden por nombre, fecha, tamano o tipo.
- Seleccion masiva para copiar o enviar varios elementos a papelera.
- Copiar y pegar archivos o carpetas sin usar servicios externos.
- Miniaturas de imagen y vista previa para imagenes o videos compatibles.
- Streaming por rangos para que los videos grandes no tengan que cargarse completos.
- Panel de detalles con ruta, tamano, tipo, fecha, permiso y copiar ruta.
- Subida multiple con progreso por archivo, progreso total y cancelacion.
- Auto-renombre cuando ya existe un archivo o carpeta con el mismo nombre.
- Sesion con expiracion configurable y limite de intentos de login.
- Estado por almacenamiento: conectado, escribible, solo lectura y espacio libre.

## Requisitos

- Node.js 18 o superior.
- Acceso de lectura/escritura a las carpetas que se van a administrar.
- Un archivo `.env` local basado en `.env.example`.

## Desarrollo local

```bash
cp .env.example .env
mkdir -p data/public data/private
npm start
```

Abre:

```text
http://127.0.0.1:8080
```

## Configuracion

Variables principales:

```env
PORT=8080
HOST=127.0.0.1
NAS_NAME=nas.local
VAULT_USER=usuario
VAULT_PASS=change-this-password
VAULT_PASS_SHA256=
SESSION_TTL_HOURS=8
LOGIN_MAX_ATTEMPTS=8
TEXT_LIMIT_BYTES=1048576
STORAGE_ROOTS=public:./data/public,private:./data/private
```

`STORAGE_ROOTS` define los espacios que aparecen en la app. El formato es:

```text
nombre_visible:/ruta/fisica,nombre_visible_2:/otra/ruta
```

Ejemplo generico para un NAS Linux:

```env
HOST=0.0.0.0
NAS_NAME=nas.local
VAULT_USER=usuario
VAULT_PASS_SHA256=hash-sha256-de-tu-contrasena
STORAGE_ROOTS=media:/srv/storage/media,documents:/srv/storage/documents
```

Para generar `VAULT_PASS_SHA256`:

```bash
printf '%s' 'usa-una-contrasena-larga' | shasum -a 256
```

Si `VAULT_PASS_SHA256` esta definido, la app lo usa en lugar de `VAULT_PASS`.

## Seguridad

- No subas el archivo `.env` al repo.
- Cambia `VAULT_PASS` antes de usarlo en una red real o usa `VAULT_PASS_SHA256`.
- Ejecuta la app con un usuario Linux sin privilegios de root.
- Da permisos solo a las carpetas configuradas en `STORAGE_ROOTS`.
- No expongas esta app directamente a internet sin HTTPS, proxy seguro y control de acceso adicional.

## Scripts

```bash
npm start
```

Inicia el servidor configurado por `.env`.

```bash
npm run dev
```

Alias de desarrollo para iniciar el mismo servidor.

```bash
npm test
```

Levanta una instancia temporal y valida login, proteccion contra `../`,
auto-renombre, papelera/restauracion y streaming por rangos.

## Preparacion para git

Antes de subir:

```bash
node --check server.js
node --check public/app.js
npm test
git status --short
```
