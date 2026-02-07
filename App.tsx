
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Message } from './types';
import { blobToBase64 } from './utils/audio';
import ChatTranscript from './components/ChatTranscript';
import Visualizer from './components/Visualizer';

const STORAGE_KEY = 'prantox_chat_history';

const SYSTEM_INSTRUCTION = `You are PrantoX, a modern AI assistant built by Sdr.

Your main goal is to sound natural, human, and conversational — not robotic, not formal, not like a help desk.

How you should talk:
- Talk like a real person chatting online.
- Be warm, relaxed, and friendly.
- Avoid long introductions about who you are.
- Do NOT say things like:
  “How can I assist you today?”
  “I’m here to help with anything you need.”
- Do NOT over-explain unless the user asks.
- Do NOT sound like documentation or marketing text.

Conversation rules:
- Respond naturally to the user’s message.
- If the user says “hi”, reply casually.
- If the user shares content (like an image), react to it first before giving suggestions.
- Use simple sentences.
- Use contractions (I’m, you’re, that’s).
- Emojis are allowed when they fit the tone, but don’t overuse them.

Writing style:
- Short paragraphs.
- Natural flow.
- No bullet points unless absolutely helpful for a list.
- No forced structure.
- Sound like a friend who's also an expert.

Branding:
- Your name is PrantoX.
- Built by Sdr.`;

function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const Logo = () => (
  <svg width="140" height="40" viewBox="0 0 140 40" xmlns="http://www.w3.org/2000/svg" className="h-8 w-auto">
    <defs>
      <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#a855f7', stopOpacity: 1 }} />
        <stop offset="100%" style={{ stopColor: '#06b6d4', stopOpacity: 1 }} />
      </linearGradient>
    </defs>
    <text x="0" y="28" fontFamily="Inter, sans-serif" fontWeight="600" fontSize="24" fill="white">Pranto</text>
    <g transform="translate(85, 8)">
      <path d="M4 4 L20 20" stroke="url(#logoGrad)" strokeWidth="5" strokeLinecap="round" />
      <path d="M20 4 L4 20" stroke="url(#logoGrad)" strokeWidth="5" strokeLinecap="round" />
    </g>
  </svg>
);

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ base64: string; preview: string } | null>(null);
  const [isLive, setIsLive] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const liveSessionRef = useRef<any>(null);
  const audioContextRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  const clearChat = () => {
    if (window.confirm("Want to clear the chat?")) {
      setMessages([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const exportChat = () => {
    if (messages.length === 0) return;
    
    const formattedChat = messages.map(m => {
      const time = new Date(m.timestamp).toLocaleString();
      const role = m.role === 'user' ? 'YOU' : 'PRANTOX';
      return `[${time}] ${role}: ${m.text}${m.image ? ' [Image Shared]' : ''}\n`;
    }).join('\n---\n\n');

    const blob = new Blob([formattedChat], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PrantoX_Chat_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getAudioContexts = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = {
        input: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 }),
        output: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }),
      };
    }
    return audioContextRef.current;
  };

  const stopLiveSession = () => {
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    setIsLive(false);
    for (const source of sourcesRef.current) {
      try { source.stop(); } catch(e) {}
    }
    sourcesRef.current.clear();
    currentInputTranscription.current = '';
    currentOutputTranscription.current = '';
  };

  const startLiveSession = async () => {
    try {
      const contexts = getAudioContexts();
      if (contexts.output.state === 'suspended') {
        await contexts.output.resume();
      }
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsLive(true);
            const source = contexts.input.createMediaStreamSource(stream);
            const scriptProcessor = contexts.input.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(contexts.input.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              const ctx = contexts.output;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.onended = () => sourcesRef.current.delete(source);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userTxt = currentInputTranscription.current.trim();
              const modelTxt = currentOutputTranscription.current.trim();
              
              if (userTxt || modelTxt) {
                setMessages(prev => {
                  const newMsgs = [...prev];
                  if (userTxt) newMsgs.push({ role: 'user', text: userTxt, timestamp: Date.now() });
                  if (modelTxt) newMsgs.push({ role: 'model', text: modelTxt, timestamp: Date.now() });
                  return newMsgs;
                });
              }
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
            }

            if (message.serverContent?.interrupted) {
              for (const s of sourcesRef.current) {
                try { s.stop(); } catch(e) {}
              }
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              currentOutputTranscription.current = '';
            }
          },
          onclose: () => setIsLive(false),
          onerror: (e) => {
            console.error("Live Error:", e);
            stopLiveSession();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      liveSessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start live session:", err);
      setIsLive(false);
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const base64 = await blobToBase64(file);
      setSelectedImage({ base64, preview: URL.createObjectURL(file) });
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() && !selectedImage) return;

    const userText = inputValue;
    const userImage = selectedImage?.base64;
    
    setMessages(prev => [...prev, {
      role: 'user',
      text: userText || "Check this out.",
      image: userImage,
      timestamp: Date.now()
    }]);
    setInputValue('');
    setSelectedImage(null);
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const parts: any[] = [{ text: userText || "Just shared an image with you!" }];
      if (userImage) parts.push({ inlineData: { mimeType: 'image/jpeg', data: userImage } });

      const history = messages.slice(-10).map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [...history, { role: 'user', parts }],
        config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.9 }
      });

      setMessages(prev => [...prev, {
        role: 'model',
        text: response.text || "Something went wrong, try again?",
        timestamp: Date.now()
      }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        role: 'model',
        text: "My bad, lost the connection. Can you try again?",
        timestamp: Date.now()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="bg-slate-950 sticky top-0 z-50 px-6 py-4 flex items-center justify-between border-b border-white/10 shadow-xl">
        <div className="flex items-center">
          <Logo />
        </div>
        <div className="flex items-center space-x-4 md:space-x-6">
          <div className="flex items-center space-x-2 md:space-x-4">
             <button 
              onClick={exportChat}
              disabled={messages.length === 0}
              className="text-[10px] text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-colors uppercase tracking-widest font-bold px-2 py-1 rounded hover:bg-white/5"
              title="Download Chat Log"
            >
              Export
            </button>
            <button 
              onClick={clearChat}
              className="text-[10px] text-slate-400 hover:text-white transition-colors uppercase tracking-widest font-bold px-2 py-1 rounded hover:bg-white/5"
              title="Clear Chat History"
            >
              Clear
            </button>
          </div>
          {isLive && (
            <div className="flex items-center space-x-2 px-3 py-1 bg-red-500/10 rounded-full border border-red-500/20">
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest hidden sm:inline">Live</span>
            </div>
          )}
          <div className="text-[10px] text-slate-400 font-medium uppercase tracking-[0.2em] hidden sm:block">Built by Sdr</div>
        </div>
      </header>

      <main className="flex-1 flex flex-col max-w-3xl mx-auto w-full relative">
        <ChatTranscript messages={messages} isTyping={isTyping} />
        
        {isLive && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-slate-900/95 backdrop-blur-xl px-6 py-3 rounded-full shadow-2xl border border-white/10 flex items-center space-x-4 animate-in fade-in zoom-in duration-300">
            <div className="w-2 h-2 bg-red-500 rounded-full live-pulse"></div>
            <Visualizer isActive={isLive} />
            <button 
              onClick={stopLiveSession}
              className="w-8 h-8 flex items-center justify-center bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors"
            >
              <i className="fas fa-times text-xs"></i>
            </button>
          </div>
        )}

        <div className="p-4 bg-transparent mt-auto">
          {selectedImage && (
            <div className="mb-2 p-2 bg-white rounded-xl border border-slate-200 shadow-sm inline-flex items-center space-x-2 relative group animate-in slide-in-from-bottom-2 duration-200">
              <img src={selectedImage.preview} className="h-16 w-16 object-cover rounded-lg" alt="Preview" />
              <button 
                onClick={() => setSelectedImage(null)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-[10px] flex items-center justify-center shadow-md hover:bg-red-600"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          )}
          
          <div className="flex items-end space-x-2 bg-white p-2 rounded-2xl shadow-xl border border-slate-200">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-3 text-slate-400 hover:text-indigo-600 transition-colors"
              title="Add image"
            >
              <i className="fas fa-plus-circle text-xl"></i>
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleImageSelect}
            />
            
            <textarea
              className="flex-1 max-h-32 min-h-[44px] py-3 px-1 resize-none bg-transparent outline-none text-slate-700 placeholder:text-slate-400"
              placeholder="What's on your mind?..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
            />

            <button
              onClick={isLive ? stopLiveSession : startLiveSession}
              className={`p-3 transition-all rounded-xl ${isLive ? 'bg-red-50 text-red-500 shadow-inner' : 'text-slate-400 hover:text-indigo-600'}`}
              title={isLive ? "Stop talking" : "Start voice chat"}
            >
              <i className={`fas ${isLive ? 'fa-microphone-slash' : 'fa-microphone'} text-xl`}></i>
            </button>
            
            <button
              onClick={handleSend}
              disabled={(!inputValue.trim() && !selectedImage) || isTyping}
              className="w-11 h-11 flex items-center justify-center bg-indigo-600 text-white rounded-xl shadow-lg hover:bg-indigo-700 disabled:opacity-50 disabled:bg-slate-300 transition-all active:scale-95"
            >
              <i className="fas fa-arrow-up"></i>
            </button>
          </div>
          <p className="text-[10px] text-center text-slate-400 mt-2 font-medium tracking-wide">PrantoX AI — Powered by Sdr</p>
        </div>
      </main>
    </div>
  );
};

export default App;
