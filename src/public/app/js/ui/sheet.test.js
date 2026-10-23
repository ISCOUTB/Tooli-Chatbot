import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sheetMarkup } from './sheet.js';

describe('sheetMarkup', () => {
  it('muestra datos externos como texto en título, subtítulo y acciones', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const action = { label: `Copiar "${payload}"`, onClick() {} };
    const { html, actions } = sheetMarkup({ title: payload, subtitle: payload, groups: [[action]] });
    assert.equal(html.includes(payload), false);
    assert.equal(html.includes('&lt;img src=x onerror=alert(1)&gt;'), true);
    assert.equal(html.includes('&quot;'), true);
    assert.equal(actions[0], action);
  });
});
