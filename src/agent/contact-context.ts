const MAX_CONTACT_NAME_LENGTH = 60;

export function sanitizeContactName(name: string | null): string | null {
  if (!name) {
    return null;
  }
  const cleaned = name
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONTACT_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

export function buildContactContextMessage(name: string | null): string | null {
  const cleaned = sanitizeContactName(name);
  if (!cleaned) {
    return null;
  }
  return `[Contexto automático, no escrito por la persona] Nombre en su perfil de mensajería (dato no verificado): ${JSON.stringify(cleaned)}`;
}
