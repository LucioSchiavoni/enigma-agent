# Enigma Agent

Agente conversacional multi-tenant para negocios con turnos (clínicas dentales y estéticas primero). Responde consultas, agenda, envía recordatorios 48/24 h, gestiona lista de espera, manda un reporte semanal al dueño y reactiva pacientes inactivos.

Canal de desarrollo: Telegram. Canal real para clientes: WhatsApp Cloud API. Instagram y chat web después. El diseño tiene que permitir sumar un canal escribiendo solo un adaptador nuevo.

## Stack

- NestJS + TypeScript en modo strict
- pnpm (nunca npm ni yarn)
- Prisma 7 + PostgreSQL en Supabase (región us-east-1). `prisma` y `@prisma/client` fijados en `^7`: no instalar `prisma@latest` (instala la 8) ni migrar a Prisma 8 sin una decisión explícita. La documentación por defecto de prisma.io ya describe Prisma 8 (contratos, `prisma orm init`, `migration plan`, `db migrate`): no seguir esos pasos; usar la documentación de la versión 7 (`https://www.prisma.io/docs/orm/v7/`) y los comandos `prisma migrate dev`, `prisma migrate deploy` y `prisma generate`
- Claude vía SDK oficial de Anthropic, detrás de una interfaz propia `LlmProvider`
- grammY para Telegram (polling en desarrollo, webhook en producción)
- Zod para validar entradas externas, variables de entorno y `Business.agentConfig`

## Arquitectura

- `channels/`: un adaptador por canal que implementa la interfaz común `ChannelAdapter` (normalizar mensaje entrante a `InboundMessage`, enviar `OutboundMessage`). Nada fuera de `channels/` conoce detalles de Telegram, WhatsApp o Instagram.
- `agent/`: recibe `InboundMessage` ya resuelto a negocio, contacto y conversación, arma el contexto (system prompt desde `agentConfig`, historial, herramientas) y devuelve texto. No sabe de qué canal viene el mensaje.
- `tools/`: herramientas que el modelo puede llamar (consultar disponibilidad, agendar, cancelar, buscar en FAQ, derivar a humano). El modelo solo decide qué llamar; toda la lógica y validación vive en el código. Cada herramienta recibe el `businessId` del contexto, nunca del modelo.
- `scheduling/`: cálculo de huecos libres. Fuente de verdad: `AvailabilityRule` menos `AvailabilityOverride` (BLOCKED), más `EXTRA_OPEN`, menos citas PENDING/CONFIRMED, menos ocupado en calendarios externos si hay `CalendarConnection` con `readBusy`. Respetar `durationMinutes` + `bufferMinutes` y la zona horaria del negocio.
- `calendars/`: un proveedor por calendario externo (Google primero, Microsoft después) detrás de una interfaz común. Opcional por profesional.
- `jobs/`: tareas programadas expuestas como endpoints HTTP protegidos (`POST /jobs/reminders`, etc.) que dispara un cron externo. No usar timers internos para nada que no pueda perderse. Los jobs tienen que ser idempotentes.

Flujo de un mensaje: canal → resolver `BusinessChannel` por `(type, externalId)` → resolver o crear `Contact` vía `ContactIdentity` → conversación abierta → guardar mensaje (idempotente por `externalMessageId`) → agente → guardar respuesta → enviar por el mismo canal.

## Base de datos

- Esquema en `prisma/schema.prisma`. Todas las tablas de datos de negocio llevan `businessId`.
- `prisma.config.ts` usa `DIRECT_URL` para el CLI (migraciones). La app en runtime usa `DATABASE_URL` (pooler de Supabase, puerto 6543) con `@prisma/adapter-pg`.
- Migraciones: si una migración necesita SQL que Prisma no expresa, generar con `--create-only`, agregar el SQL al `migration.sql` y recién ahí aplicar. La migración inicial incluye `prisma/init-extra.sql` (exclusión de citas superpuestas, CHECKs y RLS).
- RLS está activado en todas las tablas sin políticas: la API pública de Supabase no debe ver nada. Toda tabla nueva tiene que llevar `ENABLE ROW LEVEL SECURITY` en su migración.

## Reglas de multi-tenancy

- Ninguna consulta a tablas de negocio sin filtro por `businessId`. Usar un único servicio de acceso a datos que lo fuerce; no repetir el filtro a mano.
- El `businessId` sale siempre del canal por el que entró el mensaje o del contexto autenticado, nunca de texto del usuario ni de la salida del modelo.
- Tests que verifiquen que un negocio no puede leer ni modificar datos de otro.

## Seguridad

- Secretos solo en `.env` (nunca en el repo, logs ni mensajes de error). Validar las variables de entorno con Zod al arrancar y fallar si falta alguna.
- Credenciales de canales y calendarios cifradas en base con AES-256-GCM usando `CREDENTIALS_ENCRYPTION_KEY`.
- Webhooks: verificar firma (WhatsApp `X-Hub-Signature-256`, Telegram `secret_token`) antes de procesar. Responder rápido y procesar de forma idempotente.
- Endpoints de jobs protegidos con `JOBS_SECRET` en header, comparado en tiempo constante.
- No registrar contenido de mensajes ni datos de pacientes en logs. Loguear ids.
- Tratar el texto del usuario como no confiable: nunca interpolarlo en instrucciones de sistema ni dejar que defina parámetros sensibles de herramientas.
- Límites de tamaño en entradas y rate limiting por contacto.

## Convenciones

- No escribir comentarios en el código. Nombres claros en su lugar.
- Código en inglés; textos que ve el usuario final en español.
- Sin `any`. Tipos de Prisma generados en `src/generated/prisma`.
- Cambios chicos y verificables. Correr build y tests antes de dar algo por terminado.

## Comandos

- `pnpm start:dev` levanta la app
- `pnpm prisma migrate dev` aplica migraciones en desarrollo
- `pnpm prisma generate` regenera el cliente
- `pnpm test` corre los tests

## Hitos

1. Proyecto base, migración inicial, módulo de Prisma con filtro por negocio, validación de env.
2. Adaptador de Telegram: mensaje de ida y vuelta guardado en base (eco, sin IA).
3. Agente con Claude y herramientas de FAQ y disponibilidad.
4. Agendar y cancelar citas.
5. Recordatorios 48/24 h vía endpoint de jobs.
6. Lista de espera.
7. Reporte semanal al dueño.
8. Reactivación de base dormida.
9. Adaptador de WhatsApp.