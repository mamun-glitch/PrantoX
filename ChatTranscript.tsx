
import React, { useEffect, useRef } from 'react';
import { Message } from '../types';

interface ChatTranscriptProps {
  messages: Message[];
  isTyping: boolean;
}

const ChatTranscript: React.FC<ChatTranscriptProps> = ({ messages, isTyping }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const renderContent = (text: string) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith('```')) {
        const code = part.replace(/```[a-z]*\n?|```/g, '');
        return (
          <div key={index} className="my-2 p-3 bg-slate-900 text-green-400 rounded-lg code-font text-sm overflow-x-auto shadow-inner">
            <pre><code>{code.trim()}</code></pre>
          </div>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div 
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth"
    >
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center space-y-4 py-12">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
             <i className="fas fa-comments text-3xl"></i>
          </div>
          <p className="max-w-[200px] text-sm font-medium">PrantoX is ready. Ask anything or share an image to get started.</p>
        </div>
      )}
      {messages.map((msg, i) => (
        <div 
          key={i} 
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div 
            className={`max-w-[85%] rounded-2xl p-4 shadow-sm border ${
              msg.role === 'user' 
                ? 'bg-indigo-600 text-white rounded-br-none border-indigo-500' 
                : 'bg-white text-slate-800 border-slate-200 rounded-bl-none'
            }`}
          >
            {msg.image && (
              <img 
                src={`data:image/jpeg;base64,${msg.image}`} 
                alt="User upload" 
                className="rounded-lg mb-3 max-w-full h-auto border border-white/20 shadow-md"
              />
            )}
            <div className="whitespace-pre-wrap leading-relaxed text-[15px]">
              {renderContent(msg.text)}
            </div>
            <div className={`text-[10px] mt-2 opacity-50 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      ))}
      {isTyping && (
        <div className="flex justify-start">
          <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-none p-4 shadow-sm">
            <div className="flex space-x-1">
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatTranscript;
