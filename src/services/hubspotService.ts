import axios from 'axios';
import { config } from '../config';
import { describeError, maskEmail } from './logSafe';

const HUBSPOT_API = 'https://api.hubapi.com';

export interface HubspotLead {
  email: string;
  nombre: string;            // nombre completo
  whatsapp: string;          // E.164 sin '+', ej: 573001234567
  posgradoInteres: string;
  interesFinanciacion: string;
  consentimiento: boolean;
  /** Fuente del lead; si falta, HUBSPOT_FUENTE_VALOR (la del evento de posgrados). */
  fuente?: string;
  /** Pregrado que estudia o estudió (flujo de recomendación). */
  pregrado?: string;
  /** Relación con la UTB: egresado, estudiante u otra universidad. */
  relacion?: string;
}

/**
 * Crea o actualiza (upsert por correo) un contacto en el HubSpot de la UTB.
 *
 * Solo se ejecuta si HUBSPOT_ACTIVO=true y hay token. Si una propiedad
 * personalizada no existe en HubSpot, reintenta con las propiedades estándar
 * para no perder el contacto.
 *
 * Requisitos:
 *  - HUBSPOT_TOKEN: token de una Private App con scope crm.objects.contacts.write
 *  - (opcional) HUBSPOT_PROP_* con el nombre interno de las propiedades custom
 *
 * Si la propiedad de fuente es de tipo desplegable en HubSpot, los valores de
 * HUBSPOT_FUENTE_* tienen que existir como opciones; si no, HubSpot rechaza el
 * contacto y solo se guardan los datos básicos.
 */
export async function upsertContactoHubspot(lead: HubspotLead): Promise<void> {
  if (!config.hubspot.activo || !config.hubspot.token) {
    console.log('[hubspot] inactivo o sin token — omitido');
    return;
  }

  const partes = lead.nombre.trim().split(/\s+/).filter(Boolean);
  const firstname = partes[0] ?? '';
  const lastname = partes.slice(1).join(' ');

  // Propiedades estándar (siempre existen en HubSpot)
  const base: Record<string, string> = {
    email: lead.email,
    firstname,
    lastname,
    phone: `+${lead.whatsapp}`,
  };

  // Propiedades personalizadas — solo si se configuró su nombre interno
  const full: Record<string, string> = { ...base };
  if (config.hubspot.propPosgrado) full[config.hubspot.propPosgrado] = lead.posgradoInteres;
  if (config.hubspot.propFuente) full[config.hubspot.propFuente] = lead.fuente || config.hubspot.fuenteValor;
  if (config.hubspot.propConsentimiento) {
    full[config.hubspot.propConsentimiento] = lead.consentimiento ? 'true' : 'false';
  }
  if (config.hubspot.propFinanciacion) full[config.hubspot.propFinanciacion] = lead.interesFinanciacion;
  if (config.hubspot.propPregrado && lead.pregrado) full[config.hubspot.propPregrado] = lead.pregrado;
  if (config.hubspot.propRelacion && lead.relacion) full[config.hubspot.propRelacion] = lead.relacion;

  const headers = {
    Authorization: `Bearer ${config.hubspot.token}`,
    'Content-Type': 'application/json',
  };

  const doUpsert = (properties: Record<string, string>) =>
    axios.post(
      `${HUBSPOT_API}/crm/v3/objects/contacts/batch/upsert`,
      { inputs: [{ idProperty: 'email', id: lead.email, properties }] },
      { headers, timeout: 15_000 }
    );

  try {
    await doUpsert(full);
    console.log('[hubspot] contacto upsert OK:', maskEmail(lead.email));
  } catch (err: unknown) {
    console.error('[hubspot] error upsert (reintento con datos básicos):', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
    // Reintento con solo propiedades estándar (por si alguna custom no existe)
    try {
      await doUpsert(base);
      console.log('[hubspot] contacto upsert OK (básico):', maskEmail(lead.email));
    } catch (err2: unknown) {
      console.error('[hubspot] error definitivo:', describeError({ response: { status: axios.isAxiosError(err2) ? err2.response?.status : undefined } }));
    }
  }
}
