import { fail, hash } from '../json.js';
import { archiveFromChat, browserWriteLock } from './sillytavern.js';

/** A delayed save may outlive its controller. Never let it replace a different saved SOLVE archive. */
export async function guardUnboundNativeSave(body: any, headers: Record<string, string>, fetcher: typeof fetch, send: () => Promise<Response>): Promise<Response> {
  return browserWriteLock(`solve:${body.file_name}`, async () => {
    const response = await fetcher('/api/chats/get', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: body.file_name, avatar_url: body.avatar_url }) });
    if (!response.ok) fail('HOST_SAVE_FAILED', '保存前无法核对磁盘聊天');
    const file = await response.json();
    const remote = Array.isArray(file) && file.length ? archiveFromChat(file[0].chat_metadata ?? {}, file.slice(1)) : undefined;
    if (remote) {
      const incoming = Array.isArray(body.chat) && body.chat.length ? archiveFromChat(body.chat[0].chat_metadata ?? {}, body.chat.slice(1)) : undefined;
      if (!incoming || await hash(incoming) !== await hash(remote))
        fail('REMOTE_HEAD_CHANGED', '聊天尚未绑定或已切换，原生保存已阻止，请重新加载聊天后继续');
    }
    return send();
  });
}
