import { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Star } from 'lucide-react';
import './LiveChat.css';

const SYSTEM_MESSAGES = [
    "🔥 Match hype is real!",
    "ShadowStrike looks dangerous today.",
    "Whale alert! 5000 MON bet placed.",
    "Who is winning this round?",
    "Blue team has better strategy.",
    "Red team equipment is OP!",
    "LFG!!!",
    "Monad speed is insane ⚡",
    "Anyone else lagging? (Just kidding, it's Monad)",
    "Betting closes soon, hurry up!",
];

const USERS = [
    { name: "CryptoNinja", color: "#00f2ea" },
    { name: "MonadMaxi", color: "#836ef9" },
    { name: "ArenaKing", color: "#ff0055" },
    { name: "SatoshiFan", color: "#ffe600" },
    { name: "GigaChad", color: "#00ff9d" },
];

export default function LiveChat({ gameState, walletConnected = false }) {
    const [messages, setMessages] = useState([
        { id: 1, user: "System", text: "Welcome to Agent Clash Arena Global Chat! 🌍", type: "system" },
        { id: 2, user: "MonadBot", text: "Please be respectful and enjoy the chaos.", type: "system" }
    ]);
    const [inputValue, setInputValue] = useState("");
    const messagesContainerRef = useRef(null);

    // Auto-scroll to bottom (Local only, no window jump)
    useEffect(() => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Simulate chat activity
    useEffect(() => {
        const interval = setInterval(() => {
            if (Math.random() > 0.7) {
                const randomUser = USERS[Math.floor(Math.random() * USERS.length)];
                const randomMsg = SYSTEM_MESSAGES[Math.floor(Math.random() * SYSTEM_MESSAGES.length)];
                addMessage(randomUser.name, randomUser.color, randomMsg);
            }
        }, 3000); // New message every ~3s on avg

        return () => clearInterval(interval);
    }, []);

    const addMessage = (user, color, text, type = 'user') => {
        setMessages(prev => {
            const newMsgs = [...prev, { id: Date.now(), user, color, text, type }];
            if (newMsgs.length > 50) newMsgs.shift(); // Keep last 50
            return newMsgs;
        });
    };

    const handleSend = (e) => {
        e.preventDefault();
        if (!inputValue.trim()) return;
        if (!walletConnected) return; // double check

        addMessage("You", "#ffffff", inputValue.trim());
        setInputValue("");
    };

    return (
        <div className="live-chat glass-card">
            <div className="live-chat__header">
                <MessageSquare size={16} />
                <span>Live Arena Chat</span>
                <span className="live-indicator"></span>
            </div>

            <div className="live-chat__messages" ref={messagesContainerRef}>
                {messages.map((msg) => (
                    <div key={msg.id} className={`chat-message ${msg.type}`}>
                        {msg.type === 'system' ? (
                            <span className="chat-message__system">
                                <Star size={10} style={{ marginRight: 4 }} /> {msg.text}
                            </span>
                        ) : (
                            <>
                                <span className="chat-message__user" style={{ color: msg.color }}>{msg.user}:</span>
                                <span className="chat-message__text">{msg.text}</span>
                            </>
                        )}
                    </div>
                ))}
            </div>

            <form className="live-chat__input-area" onSubmit={handleSend}>
                <input
                    type="text"
                    className="live-chat__input"
                    placeholder={walletConnected ? "Say something..." : "Connect wallet to chat 🔒"}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    disabled={!walletConnected}
                />
                <button
                    type="submit"
                    className="live-chat__send-btn"
                    disabled={!walletConnected || !inputValue.trim()}
                    style={{ opacity: !walletConnected ? 0.5 : 1 }}
                >
                    <Send size={14} />
                </button>
            </form>
        </div>
    );
}
