export const mockChats = [
  {
    id: '1',
    title: 'Welcome chat',
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Hi, I am your AI assistant. Ask me anything!',
        createdAt: '09:00',
      },
      {
        id: 'm2',
        role: 'user',
        content: 'Show me a ChatGPT-like UI in React.',
        createdAt: '09:01',
      },
      {
        id: 'm3',
        role: 'assistant',
        content: 'Here is a simple example UI layout.',
        createdAt: '09:02',
      },
    ],
  },
  {
    id: '2',
    title: 'Travel ideas',
    messages: [
      {
        id: 'm4',
        role: 'user',
        content: 'Suggest a weekend trip near me.',
        createdAt: '14:15',
      },
      {
        id: 'm5',
        role: 'assistant',
        content: 'Here are a few options you might like...',
        createdAt: '14:16',
      },
    ],
  },
];
