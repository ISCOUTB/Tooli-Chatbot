import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioError, MAX_AUDIO_BYTES, MAX_TRANSCRIPCION, descargarAudioMeta, extensionDeAudio, limpiarTranscripcion,
  mensajeAudioFallido, mensajeEntendido, transcribirAudio, urlMediaPermitida,
} from './transcripcionAudio';

/** Sin red: el cliente HTTP falso responde lo que diría Meta. */
function httpFalso(info: Record<string, unknown>, archivo: Buffer | Error = Buffer.from('opus')) {
  const llamadas: { url: string; opciones: Record<string, unknown> }[] = [];
  const http = {
    get: async (url: string, opciones: Record<string, unknown> = {}) => {
      llamadas.push({ url, opciones });
      if (url.startsWith('https://graph.facebook.com/')) return { data: info };
      if (archivo instanceof Error) throw archivo;
      return { data: archivo };
    },
  };
  return { http: http as never, llamadas };
}

const INFO_OK = { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'audio/ogg; codecs=opus', file_size: 48_000 };

async function motivoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (err) {
    assert.ok(err instanceof AudioError);
    return err.motivo;
  }
  throw new Error('se esperaba un AudioError');
}

describe('formato y textos', () => {
  it('reconoce la nota de voz de WhatsApp y rechaza lo que OpenAI no abre', () => {
    assert.equal(extensionDeAudio('audio/ogg; codecs=opus'), 'ogg');
    assert.equal(extensionDeAudio('audio/mpeg'), 'mp3');
    assert.equal(extensionDeAudio('audio/mp4'), 'm4a');
    assert.equal(extensionDeAudio('audio/amr'), null);
    assert.equal(extensionDeAudio(undefined), null);
  });

  it('limpia espacios y corta lo que pasa del límite', () => {
    assert.equal(limpiarTranscripcion('  Hola,\n quiero   una maestría  '), 'Hola, quiero una maestría');
    assert.equal(limpiarTranscripcion(undefined), '');
    const largo = limpiarTranscripcion('a'.repeat(MAX_TRANSCRIPCION + 50));
    assert.equal(largo.length, MAX_TRANSCRIPCION);
    assert.ok(largo.endsWith('…'));
  });

  it('confirma lo que entendió sin repetir un audio entero', () => {
    assert.equal(mensajeEntendido('¿Cuánto cuesta el MBA?'), '🎧 Te entendí: «¿Cuánto cuesta el MBA?»');
    assert.ok(mensajeEntendido('x'.repeat(400)).length < 210);
  });

  it('explica por qué no pudo usar el audio', () => {
    assert.match(mensajeAudioFallido('muy_grande'), /largo/);
    assert.match(mensajeAudioFallido('formato'), /abrir/);
    assert.match(mensajeAudioFallido('transcripcion'), /escuchar/);
  });

  it('solo manda el token a los servidores de archivos de Meta', () => {
    assert.equal(urlMediaPermitida('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1'), true);
    assert.equal(urlMediaPermitida('http://lookaside.fbsbx.com/x'), false);
    assert.equal(urlMediaPermitida('https://fbsbx.com.atacante.com/x'), false);
    assert.equal(urlMediaPermitida('https://atacante.com/fbsbx.com'), false);
    assert.equal(urlMediaPermitida('no es una url'), false);
  });
});

describe('descargarAudioMeta', () => {
  it('pide la URL a Meta y baja el archivo con el token', async () => {
    const { http, llamadas } = httpFalso(INFO_OK);
    const audio = await descargarAudioMeta('media-1', { http, token: 'tok' });
    assert.equal(audio.mimeType, 'audio/ogg; codecs=opus');
    assert.equal(audio.buffer.toString(), 'opus');
    assert.equal(llamadas[0].url, 'https://graph.facebook.com/v20.0/media-1');
    assert.equal(llamadas[1].url, INFO_OK.url);
    assert.deepEqual(llamadas[1].opciones.headers, { Authorization: 'Bearer tok' });
    assert.equal(llamadas[1].opciones.maxContentLength, MAX_AUDIO_BYTES);
  });

  it('no descarga sin token, archivos enormes, formatos raros ni hosts ajenos', async () => {
    assert.equal(await motivoDe(descargarAudioMeta('m', { http: httpFalso(INFO_OK).http, token: '' })), 'sin_configurar');
    assert.equal(await motivoDe(descargarAudioMeta('m', { http: httpFalso({ ...INFO_OK, file_size: MAX_AUDIO_BYTES + 1 }).http, token: 't' })), 'muy_grande');
    assert.equal(await motivoDe(descargarAudioMeta('m', { http: httpFalso({ ...INFO_OK, mime_type: 'audio/amr' }).http, token: 't' })), 'formato');
    const ajeno = httpFalso({ ...INFO_OK, url: 'https://atacante.com/audio' });
    assert.equal(await motivoDe(descargarAudioMeta('m', { http: ajeno.http, token: 't' })), 'descarga');
    assert.equal(ajeno.llamadas.length, 1, 'el token no sale hacia un host ajeno');
  });

  it('distingue un archivo que se pasó del límite de un error de red', async () => {
    const grande = httpFalso(INFO_OK, new Error('maxContentLength size of 8388608 exceeded'));
    assert.equal(await motivoDe(descargarAudioMeta('m', { http: grande.http, token: 't' })), 'muy_grande');
    const caido = httpFalso(INFO_OK, new Error('socket hang up'));
    assert.equal(await motivoDe(descargarAudioMeta('m', { http: caido.http, token: 't' })), 'descarga');
  });
});

describe('transcribirAudio', () => {
  const audio = { buffer: Buffer.from('opus'), mimeType: 'audio/ogg; codecs=opus' };

  function openaiFalso(respuesta: string | Error) {
    const pedidos: Record<string, unknown>[] = [];
    const cliente = {
      audio: {
        transcriptions: {
          create: (async (params: Record<string, unknown>) => {
            pedidos.push(params);
            if (respuesta instanceof Error) throw respuesta;
            return { text: respuesta };
          }) as never,
        },
      },
    };
    return { cliente, pedidos };
  }

  it('transcribe en español con el modelo configurado', async () => {
    const { cliente, pedidos } = openaiFalso('  Hola, ¿qué maestrías tienen?  ');
    const texto = await transcribirAudio(audio, { openai: cliente, modelo: 'gpt-4o-mini-transcribe' });
    assert.equal(texto, 'Hola, ¿qué maestrías tienen?');
    assert.equal(pedidos[0].model, 'gpt-4o-mini-transcribe');
    assert.equal(pedidos[0].language, 'es');
    assert.equal((pedidos[0].file as { name: string }).name, 'nota-de-voz.ogg');
  });

  it('falla con un motivo claro', async () => {
    assert.equal(await motivoDe(transcribirAudio(audio, { openai: null })), 'sin_configurar');
    assert.equal(await motivoDe(transcribirAudio(audio, { openai: openaiFalso('   ').cliente })), 'vacio');
    assert.equal(await motivoDe(transcribirAudio(audio, { openai: openaiFalso(new Error('429')).cliente })), 'transcripcion');
    assert.equal(await motivoDe(transcribirAudio({ ...audio, mimeType: 'audio/amr' }, { openai: openaiFalso('x').cliente })), 'formato');
  });
});
