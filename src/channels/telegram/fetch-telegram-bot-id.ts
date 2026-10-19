import { Api } from 'grammy';

export async function fetchTelegramBotId(token: string): Promise<string> {
  const me = await new Api(token).getMe();
  return String(me.id);
}
