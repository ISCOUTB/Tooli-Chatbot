/**
 * Simulador de WhatsApp del panel: montaje con el flujo REAL del bot.
 * Las rutas viven en simuladorWhatsappRouter.ts (fábrica probada con dobles).
 *
 * Los flujos se cargan al primer mensaje (import dinámico): montar la API no
 * arrastra todo el grafo del bot ni abre conexiones.
 */
import Redis from 'ioredis';
import { config } from '../../config';
import { miSemestreDisponible } from '../../services/academico/interruptores';
import { logAudit } from '../../services/auditService';
import { checkRateLimit } from '../../services/rateLimit';
import { esNumeroSimulado } from '../../services/simulacion';
import { crearSimuladorWhatsappRouter } from './simuladorWhatsappRouter';

// lazyConnect: importar este módulo en una prueba no abre ningún socket.
const redis = new Redis(config.redis.url, { lazyConnect: true });

/** El perfil «aspirante que vuelve»: autorizó sus datos y el bot ya sabe su nombre. */
const ASPIRANTE_CONOCIDO = { datos: 'si', info: 'si', nombre: 'Laura Prueba', relacion: 'externo' } as const;

/**
 * Borra todo lo que el flujo guardó con ese número. Las llaves del bot llevan el
 * teléfono (session:, perfil:, consentimiento:, agenda:flujo:, otp:, campana:…) y
 * el número es de la zona de pruebas, así que el patrón no puede tocar a nadie más.
 */
async function limpiar(telefono: string): Promise<void> {
  if (!esNumeroSimulado(telefono)) throw new Error('Solo se limpian números del simulador');
  const [{ revokeIdentity }, { soltarAgendaDePrueba }] = await Promise.all([
    import('../../services/identityService'), import('../../flows/agendaFlowRuntime'),
  ]);
  // Primero el vínculo de prueba: su índice por correo (ficticio) no lleva el número en la llave.
  await revokeIdentity(telefono);
  soltarAgendaDePrueba(telefono);
  let cursor = '0';
  do {
    const [siguiente, llaves] = await redis.scan(cursor, 'MATCH', `*${telefono}*`, 'COUNT', 500);
    cursor = siguiente;
    if (llaves.length) await redis.del(...llaves);
  } while (cursor !== '0');
  // «BAJA» en el simulador lo deja en la lista de bajas de campañas (un conjunto, no una llave suya).
  await redis.srem('campana:bajas', telefono);
}

export const simuladorWhatsappRouter = crearSimuladorWhatsappRouter({
  async manejar(telefono, texto) {
    // El mismo despacho que inboundProcessor: con el evento de posgrados encendido, los mensajes van a ese flujo.
    if (config.posgradosEvento.activo) {
      const { handlePosgradoMessage } = await import('../../flows/posgrados-evento');
      await handlePosgradoMessage(telefono, texto);
      return;
    }
    const { handleMessage } = await import('../../flows');
    await handleMessage(telefono, texto);
  },
  async paso(telefono) {
    const { getSession } = await import('../../services/session');
    return (await getSession(telefono))?.step ?? null;
  },
  limpiar,
  async prepararPerfil(telefono, perfil) {
    if (perfil === 'conocido') {
      const [{ registrarDecision }, { guardarPerfil }] = await Promise.all([
        import('../../services/consentimientoService'), import('../../services/perfilService'),
      ]);
      await registrarDecision(telefono, 'si');
      await guardarPerfil(telefono, { ...ASPIRANTE_CONOCIDO });
    } else if (perfil === 'estudiante') {
      const { vincularIdentidadSimulada } = await import('../../services/identityService');
      await vincularIdentidadSimulada(telefono);
    }
  },
  limite: checkRateLimit,
  audit: logAudit,
  estado: () => ({
    ia: Boolean(config.openai.apiKey),
    adaptador: config.messagingAdapter,
    conversacional: config.conversacion.activa,
    agenda: config.agenda.activa,
    miSemestre: miSemestreDisponible(),
    // Mismo criterio que fotosPrograma.fotosDisponibles(), sin cargar el flujo: los flyers salen solo con Meta.
    flyers: config.fotos.activas && config.messagingAdapter === 'meta',
    eventoPosgrados: config.posgradosEvento.activo,
  }),
});
