/** El indicador de "escribiendo…" llegó en versiones recientes de la Graph API. */
export const GRAPH_URL_LEIDO = 'https://graph.facebook.com/v25.0';

/** Cuerpo para marcar un mensaje entrante como leído, con "escribiendo…" opcional. */
export function cuerpoLeido(messageId: string, escribiendo: boolean): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
    ...(escribiendo ? { typing_indicator: { type: 'text' } } : {}),
  };
}
