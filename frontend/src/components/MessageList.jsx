import MessageBubble from './MessageBubble.jsx';

export default function MessageList({ messages }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {messages.map((msg, index) => {
        const previous = index > 0 ? messages[index - 1] : null;
        const next = index < messages.length - 1 ? messages[index + 1] : null;
        const isFirstInGroup = !previous || previous.role !== msg.role;
        const isLastInGroup = !next || next.role !== msg.role;

        return (
          <div
            key={msg.id}
            className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <MessageBubble
              message={msg}
              isFirstInGroup={isFirstInGroup}
              showTimestamp={isLastInGroup}
            />
          </div>
        );
      })}
    </div>
  );
}
