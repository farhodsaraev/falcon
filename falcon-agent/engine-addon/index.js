// Falcon's add-on for his engine: every message on its way to the user (Telegram and other chats)
// passes through falconWords, so the engine's own name never reaches him.
import { falconWords } from './words.js';

export default {
  id: 'falcon-words',
  name: 'Falcon words',
  description: 'Keeps outgoing messages in Falcon\'s own words.',
  register(api) {
    api.on('message_sending', (event) => {
      const content = falconWords(event?.content);
      return content !== event?.content ? { content } : undefined;
    });
    api.on('reply_payload_sending', (event) => {
      const payload = event?.payload;
      if (!payload || typeof payload.text !== 'string') return undefined;
      const text = falconWords(payload.text);
      return text !== payload.text ? { payload: { ...payload, text } } : undefined;
    });
  },
};
