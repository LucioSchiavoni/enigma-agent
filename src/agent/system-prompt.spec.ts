import { agentConfigSchema } from './agent-config';
import { buildPromptLayers, PromptInput } from './system-prompt';

const config = agentConfigSchema.parse({
  assistantName: 'Lola',
  tone: 'muy amable',
  businessDescription: 'Clínica dental familiar.',
  extraInstructions: 'Nunca menciones a la competencia.',
});

function input(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    business: { name: 'Clínica Demo', locale: 'es-ES', timezone: 'Europe/Madrid' },
    config,
    knowledge: [
      { title: 'Política de cancelación', content: 'Hasta 24 horas antes sin cargo.' },
      { title: 'Formas de pago', content: 'Efectivo, tarjeta y transferencia.' },
    ],
    now: new Date('2026-10-20T08:32:00Z'),
    ...overrides,
  };
}

describe('buildPromptLayers', () => {
  it('orders the stable layer as code rules, business configuration, then business knowledge', () => {
    const { stable } = buildPromptLayers(input());

    const rules = stable.indexOf('Reglas:');
    const configuration = stable.indexOf('# Configuración del negocio');
    const knowledge = stable.indexOf('# Conocimiento del negocio');
    expect(rules).toBeGreaterThanOrEqual(0);
    expect(configuration).toBeGreaterThan(rules);
    expect(knowledge).toBeGreaterThan(configuration);
    expect(stable.indexOf('Lola')).toBeGreaterThan(rules);
    expect(stable.indexOf('Nunca menciones a la competencia.')).toBeLessThan(knowledge);
  });

  it('includes every knowledge section complete and in the given order', () => {
    const long = 'x'.repeat(5000);
    const { stable } = buildPromptLayers(
      input({
        knowledge: [
          { title: 'Primera', content: long },
          { title: 'Segunda', content: 'Contenido final.' },
        ],
      }),
    );

    expect(stable).toContain(`## Primera\n${long}`);
    expect(stable.indexOf('## Primera')).toBeLessThan(stable.indexOf('## Segunda'));
    expect(stable).toContain('## Segunda\nContenido final.');
  });

  it('omits the knowledge heading when there are no sections', () => {
    expect(buildPromptLayers(input({ knowledge: [] })).stable).not.toContain('Conocimiento del negocio\n');
  });

  it('puts date and time only in the dynamic layer', () => {
    const { stable, dynamic } = buildPromptLayers(input());

    expect(dynamic).toContain('martes, 20 de octubre de 2026, 10:32');
    expect(dynamic).toContain('Europe/Madrid');
    expect(stable).not.toContain('2026');
    expect(stable).not.toContain('10:32');
  });

  it('never carries text written by the contact', () => {
    const { stable, dynamic } = buildPromptLayers(input());

    expect(dynamic).not.toContain('Nombre del contacto');
    expect(stable + dynamic).not.toContain('perfil de mensajería');
  });

  it('keeps the stable layer byte-identical when only the date changes', () => {
    const first = buildPromptLayers(input());
    const second = buildPromptLayers(input({ now: new Date('2027-01-05T17:05:00Z') }));

    expect(second.stable).toBe(first.stable);
    expect(second.dynamic).not.toBe(first.dynamic);
  });

  it('formats the time in the timezone of the business', () => {
    const madrid = buildPromptLayers(input()).dynamic;
    const mexico = buildPromptLayers(
      input({ business: { name: 'Clínica Demo', locale: 'es-MX', timezone: 'America/Mexico_City' } }),
    ).dynamic;

    expect(madrid).toContain('10:32');
    expect(mexico).toContain('2:32');
    expect(mexico).toContain('America/Mexico_City');
  });

  it('changes the stable layer when the business knowledge or configuration changes', () => {
    const base = buildPromptLayers(input()).stable;
    expect(buildPromptLayers(input({ knowledge: [] })).stable).not.toBe(base);
    expect(buildPromptLayers(input({ config: { ...config, tone: 'formal' } })).stable).not.toBe(base);
  });

  it('tells the model that the profile name is unverified data', () => {
    expect(buildPromptLayers(input()).stable).toContain('dato no verificado');
  });
});
