// Keep a copy in memory and send snapshots in order to Falcon's local server.
function createChats(storage, makeId = () => crypto.randomUUID(), report = () => {}) {
  let chats = [];
  let active = makeId();
  let queue = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify(chats);
    queue = queue.catch(() => {}).then(() => storage.save(JSON.parse(snapshot)))
      .then(() => report(''), () => report('Chats could not be saved. Check disk space and try again.'));
    return queue;
  };
  return {
    async load() { chats = await storage.load(); if (!Array.isArray(chats)) throw new Error('Invalid history'); },
    id: () => active,
    list: () => [...chats].reverse().sort((a, b) => b.date.localeCompare(a.date)),
    current: () => chats.find((c) => c.id === active),
    select: (id) => { if (chats.some((c) => c.id === id)) active = id; },
    newChat: () => { active = makeId(); },
    remove: (id) => { chats = chats.filter((c) => c.id !== id); if (active === id) active = makeId(); save(); },
    question: (text) => {
      if (!text) return;
      let chat = chats.find((c) => c.id === active);
      if (!chat) { chat = { id: active, date: new Date().toISOString(), title: text.trim().slice(0, 45), exchanges: [] }; chats.push(chat); }
      chat.exchanges.push({ question: text, answer: '' }); save();
    },
    answer: (text, extra = {}) => { const exchange = chats.find((c) => c.id === active)?.exchanges.at(-1); if (exchange) { Object.assign(exchange, { answer: text }, extra); save(); } },
    media: (chatId, index, items, text) => { const exchange = chats.find((c) => c.id === chatId)?.exchanges[index]; if (exchange) { exchange.media = [...(exchange.media || []), ...items]; if (text) exchange.mediaText = text; save(); } },
    flush: () => queue,
  };
}
