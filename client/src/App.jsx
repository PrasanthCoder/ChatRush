import { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import { FaImage } from "react-icons/fa";
import { formatTimestamp } from "./utils/formatConvertions.js";
import * as encryption from "./utils/encryption.js";
import { useChatActions } from "./hooks/useChatActions";

const socket = io({
  autoConnect: false, // manual connection
  reconnection: true, // Enable reconnection
  reconnectionAttempts: Infinity, // Keep trying to reconnect
  reconnectionDelay: 500, // reconnection delay
  reconnectionDelayMax: 2500, // Max delay of 2.5 second
});

function App() {
  const [page, setPage] = useState("home");
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [roomType, setRoomType] = useState(null);
  const [myKeyPair, setMyKeyPair] = useState(null);
  const [otherUserId, setOtherUserId] = useState(null);
  const [otherUserNickname, setOtherUserNickname] = useState(null);
  const [otherUserPublicKey, setOtherUserPublicKey] = useState(null);
  const [symmetricKey, setSymmetricKey] = useState(null);
  const [isCreator, setIsCreator] = useState(false);
  const [userNicknames, setUserNicknames] = useState(new Map());
  const [securityStatus, setSecurityStatus] = useState(
    "Encryption: Setting up..."
  );
  const [renderKey, setRenderKey] = useState(0); // For forcing re-render
  const chatboxRef = useRef(null);
  const textareaRef = useRef(null); // Ref for textarea to reset height
  const fileInputRef = useRef(null); // Ref for file input

  const { handleSendMessage, handleImageUpload } = useChatActions(
    socket,
    setMessages,
    message, // Pass the current message state value
    setMessage, // Pass the setter function
    roomCode,
    roomType,
    otherUserPublicKey,
    symmetricKey,
    nickname,
    formatTimestamp,
    textareaRef
  );

  // socket connection after first render
  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);

  // key-pair gen after first render
  useEffect(() => {
    async function initializeKeys() {
      console.log("Initializing key pair");
      const result = await encryption.generateKeyPair(setSecurityStatus);
      if (result.success) {
        setSecurityStatus("Encryption: Ready (waiting for peer)");
        setMyKeyPair(result.keyPair);
      } else {
        setSecurityStatus(result.error);
        alert(
          "Failed to set up encryption. Please use a local IP (e.g., 192.168.1.x) or enable HTTPS."
        );
      }
    }
    initializeKeys();
  }, []);

  // Auto-scroll to the bottom when messages change
  useEffect(() => {
    if (chatboxRef.current) {
      chatboxRef.current.scrollTop = chatboxRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle textarea expansion and shrinking based on content height
  const handleTextareaChange = (e) => {
    const textarea = e.target;
    setMessage(textarea.value);
    textarea.style.height = "5px";
    textarea.style.height = textarea.scrollHeight + "px";
  };

  // Socket.IO event handlers
  useEffect(() => {
    socket.on("roomCreated", async ({ roomCode, nickname, roomType: type }) => {
      console.log(
        "roomCreated triggered, roomType:",
        type,
        "myKeyPair:",
        !!myKeyPair
      );
      setRoomType(type);
      setIsCreator(true);
      if (type === "group") {
        setUserNicknames(new Map([[socket.id, nickname]]));
        setSecurityStatus(`Encryption: Secured (Symmetric, 0 peer(s))`);
      }
      setPage("chat");
      alert(
        `Share this code to join ${
          type === "group" ? "group" : "two-user"
        } chat: ${roomCode}`
      );
    });

    socket.on(
      "roomJoined",
      async ({ roomCode, nickname, roomType: type, existingUsers }) => {
        console.log(
          "roomJoined triggered, roomType:",
          type,
          nickname,
          "myKeyPair:",
          !!myKeyPair,
          "existingUsers:",
          existingUsers
        );
        setRoomType(type);
        setIsCreator(false);
        if (type === "two-user") {
          setOtherUserNickname(existingUsers[0]?.nickname || "Unknown");
          setOtherUserId(existingUsers[0]?.userId || null);
          if (myKeyPair) {
            try {
              const publicKey = await encryption.exportPublicKey(
                myKeyPair.publicKey
              );
              socket.emit("sharePublicKey", {
                userId: existingUsers[0]?.userId || null,
                publicKey,
                roomCode,
              });
            } catch (err) {
              console.error("Failed to share public key in roomJoined:", err);
            }
          }
        } else {
          const newNicknames = new Map([[socket.id, nickname]]);
          existingUsers.forEach((user) =>
            newNicknames.set(user.userId, user.nickname)
          );
          setUserNicknames(newNicknames);
          setSecurityStatus(
            `Encryption: Secured (Symmetric, ${newNicknames.size - 1} peer(s))`
          );
        }
        setPage("chat");
      }
    );

    socket.on("invalidRoom", () =>
      alert("Invalid room code. Please try again.")
    );
    socket.on("invalidNickname", () => alert("Please enter a valid nickname."));
    socket.on("roomFull", () =>
      alert("This room is full (maximum 2 users). Please try another room.")
    );
    socket.on("nicknameTaken", () => {
      alert(
        "This nickname is already in use in the room. Please choose a different nickname."
      );
      setPage("home");
      setRoomCode("");
    });

    socket.on("newUser", async ({ userId, roomType, nickname, publicKey }) => {
      console.log(
        "newUser triggered, roomType:",
        roomType,
        "myKeyPair:",
        !!myKeyPair,
        "userId:",
        userId
      );
      if (roomType === "two-user") {
        setOtherUserId(userId);
        setOtherUserNickname(nickname);
        if (myKeyPair) {
          try {
            const myPublicKey = await encryption.exportPublicKey(
              myKeyPair.publicKey
            );
            socket.emit("sharePublicKey", {
              userId,
              publicKey: myPublicKey,
              roomCode: roomCode,
            });
          } catch (err) {
            console.error("Failed to share public key in newUser:", err);
          }
        }
      } else {
        setUserNicknames((prev) => new Map(prev).set(userId, nickname));
        if (isCreator && publicKey && symmetricKey) {
          const importedPublicKey = await encryption.importPublicKey(publicKey);
          const exportedSymmetricKey = await encryption.exportSymmetricKey(
            symmetricKey
          );
          const encryptedSymmetricKey = await encryption.encryptMessageRSA(
            exportedSymmetricKey,
            importedPublicKey
          );
          socket.emit("shareEncryptedSymmetricKey", {
            userId,
            encryptedSymmetricKey,
            roomCode: roomCode,
          });
        }
        setSecurityStatus(
          `Encryption: Secured (Symmetric, ${userNicknames.size} peer(s))`
        );
      }
    });

    socket.on("userJoined", ({ userId, nickname }) => {
      const messageText =
        userId === socket.id
          ? "You joined the chat."
          : `${nickname} joined the chat.`;
      setMessages((prev) => [
        ...prev,
        { sender: "System", text: messageText, timestamp: formatTimestamp() },
      ]);
    });

    socket.on("receivedPublicKey", async ({ userId, publicKey, roomType }) => {
      console.log(
        "receivedPublicKey triggered, roomType:",
        roomType,
        "userId:",
        userId
      );
      if (roomType === "two-user") {
        try {
          setOtherUserId(userId || otherUserId);
          setOtherUserPublicKey(await encryption.importPublicKey(publicKey));
          setSecurityStatus("Encryption: Secured (end-to-end encrypted)");
        } catch (err) {
          console.error("Failed to process received public key:", err);
        }
      }
    });

    socket.on("receiveSymmetricKey", async ({ encryptedSymmetricKey }) => {
      try {
        const decryptedKey = await encryption.decryptMessageRSA(
          encryptedSymmetricKey,
          myKeyPair.privateKey
        );
        setSymmetricKey(await encryption.importSymmetricKey(decryptedKey));
        setSecurityStatus(
          `Encryption: Secured (Symmetric, ${userNicknames.size - 1} peer(s))`
        );
      } catch (err) {
        console.error("Failed to process symmetric key:", err);
      }
    });

    socket.on("newCreator", ({ roomCode }) => {
      if (roomCode) {
        setIsCreator(true);
        setMessages((prev) => [
          ...prev,
          {
            sender: "System",
            text: "You are now the group chat creator.",
            timestamp: formatTimestamp(),
          },
        ]);

        if (roomType === "group") {
          setSecurityStatus(
            `Encryption: Secured (Symmetric, ${userNicknames.size - 1} peer(s))`
          );
        }
      }
    });

    socket.on("userLeft", ({ userId, nickname }) => {
      if (roomType === "two-user" && userId === otherUserId) {
        setOtherUserId(null);
        setOtherUserNickname(null);
        setOtherUserPublicKey(null);
        setSecurityStatus("Encryption: Ready (waiting for peer)");
        setMessages((prev) => [
          ...prev,
          {
            sender: "System",
            text: `${nickname} has left the chat.`,
            timestamp: formatTimestamp(),
          },
        ]);
      } else if (roomType === "group") {
        setUserNicknames((prev) => {
          const newMap = new Map(prev);
          newMap.delete(userId);
          setSecurityStatus(
            `Encryption: Secured (Symmetric, ${newMap.size - 1} peer(s))`
          );
          return newMap;
        });
        setMessages((prev) => [
          ...prev,
          {
            sender: "System",
            text: `${nickname} has left the chat.`,
            timestamp: formatTimestamp(),
          },
        ]);
      }
    });

    socket.on(
      "newEncryptedMessage",
      async ({ senderId, encryptedMessage, roomType: type }) => {
        if (senderId !== socket.id) {
          let decrypted;
          if (type === "two-user") {
            const { encrypted, iv, encryptedKey } = encryptedMessage;
            const decryptedKey = await encryption.decryptMessageRSA(
              encryptedKey,
              myKeyPair.privateKey
            );
            const aesKey = await encryption.importSymmetricKey(decryptedKey);
            decrypted = await encryption.decryptMessageAES(
              encrypted,
              iv,
              aesKey
            );
            setMessages((prev) => [
              ...prev,
              {
                sender: otherUserNickname,
                type: "text",
                content: decrypted,
                timestamp: formatTimestamp(),
              },
            ]);
          } else {
            const { encrypted, iv } = encryptedMessage;
            decrypted = await encryption.decryptMessageAES(
              encrypted,
              iv,
              symmetricKey
            );
            setMessages((prev) => [
              ...prev,
              {
                sender: userNicknames.get(senderId) || "Unknown",
                type: "text",
                content: decrypted,
                timestamp: formatTimestamp(),
              },
            ]);
          }
        }
      }
    );

    socket.on(
      "newEncryptedImage",
      async ({ senderId, encryptedImage, roomType: type }) => {
        if (senderId !== socket.id) {
          let decrypted;
          if (type === "two-user") {
            const { encrypted, iv, encryptedKey } = encryptedImage;
            const decryptedKey = await encryption.decryptMessageRSA(
              encryptedKey,
              myKeyPair.privateKey
            );
            const aesKey = await encryption.importSymmetricKey(decryptedKey);
            decrypted = await encryption.decryptMessageAES(
              encrypted,
              iv,
              aesKey
            );
            setMessages((prev) => [
              ...prev,
              {
                sender: otherUserNickname,
                type: "image",
                content: decrypted,
                timestamp: formatTimestamp(),
              },
            ]);
          } else {
            const { encrypted, iv } = encryptedImage;
            decrypted = await encryption.decryptMessageAES(
              encrypted,
              iv,
              symmetricKey
            );
            setMessages((prev) => [
              ...prev,
              {
                sender: userNicknames.get(senderId) || "Unknown",
                type: "image",
                content: decrypted,
                timestamp: formatTimestamp(),
              },
            ]);
          }
        }
      }
    );

    return () => {
      socket.off("roomCreated");
      socket.off("roomJoined");
      socket.off("invalidRoom");
      socket.off("invalidNickname");
      socket.off("roomFull");
      socket.off("nicknameTaken");
      socket.off("newUser");
      socket.off("userJoined");
      socket.off("receiveSymmetricKey");
      socket.off("newCreator");
      socket.off("userLeft");
      socket.off("newEncryptedMessage");
      socket.off("newEncryptedImage");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    roomType,
    myKeyPair,
    symmetricKey,
    isCreator,
    otherUserId,
    otherUserNickname,
    userNicknames,
  ]);

  // Handlers
  const handleCreateRoom = async () => {
    console.log("handleCreateRoom triggered, myKeyPair:", !!myKeyPair);
    if (!nickname) {
      alert("Please enter a nickname.");
      return;
    }
    if (!myKeyPair) {
      alert("Encryption keys not ready. Please try again.");
      return;
    }
    socket.emit("createRoom", { nickname });
  };

  const handleCreateGroupRoom = async () => {
    console.log("handleCreateGroupRoom triggered, myKeyPair:", !!myKeyPair);
    if (!nickname) {
      alert("Please enter a nickname.");
      return;
    }
    if (!myKeyPair) {
      alert("Encryption keys not ready. Please try again.");
      return;
    }
    const symKey = await encryption.generateSymmetricKey();
    if (!symKey) {
      alert("Symmetric key generation failed. Please try again.");
      return;
    }
    setSymmetricKey(symKey);
    socket.emit("createGroupRoom", { nickname });
  };

  const handleJoinRoom = async () => {
    console.log("handleJoinRoom triggered, myKeyPair:", !!myKeyPair);
    if (!nickname) {
      alert("Please enter a nickname.");
      return;
    }
    if (!roomCode) {
      alert("Please enter a room code.");
      return;
    }
    if (!myKeyPair) {
      alert("Encryption keys not ready. Please try again.");
      return;
    }
    try {
      console.log("Attempting to export public key in handleJoinRoom");
      const publicKey = await encryption.exportPublicKey(myKeyPair.publicKey);
      socket.emit("joinRoom", {
        roomCode: roomCode.toUpperCase(),
        nickname,
        publicKey,
      });
    } catch (err) {
      console.error("Failed to export public key in handleJoinRoom:", err);
      alert("Encryption setup failed. Please try again.");
    }
  };

  const handleDisconnect = async () => {
    console.log("Disconnecting from room:", roomCode);
    if (roomCode) {
      socket.emit("leaveRoom", { roomCode: roomCode, nickname: nickname });
      socket.disconnect();
    }

    // Reset state
    setRoomCode(null);
    setRoomType(null);
    setNickname(null);
    setOtherUserId(null);
    setOtherUserNickname(null);
    setOtherUserPublicKey(null);
    setSymmetricKey(null);
    setIsCreator(false);
    setUserNicknames(new Map());
    setMessages([]);
    setSecurityStatus("Encryption: Ready (waiting for peer)");
    setPage("home");
    setRenderKey((prev) => prev + 1);

    // Reconnect socket for future use
    socket.connect();
  };

  return (
    <div key={renderKey} className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white sticky top-0 z-10 shadow-lg">
        <div className="flex-row max-w-2xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-extrabold tracking-tight">ConnectMe</h1>
          <h1>Your chats are Anonymous and Encrypted!</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex items-center justify-center p-4">
        {page === "home" ? (
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <input
              type="text"
              className="w-full p-3 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
            <div className="flex gap-2 mb-4">
              <button
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition"
                onClick={handleCreateRoom}
              >
                Create Chat (2 Users)
              </button>
              <button
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition"
                onClick={handleCreateGroupRoom}
              >
                Create Group Chat
              </button>
            </div>
            <div className="flex items-center mb-4">
              <hr className="flex-grow border-gray-300" />
              <span className="mx-2 text-gray-500">or</span>
              <hr className="flex-grow border-gray-300" />
            </div>
            <input
              type="text"
              className="w-full p-3 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Room Code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
            />
            <button
              className="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition"
              onClick={handleJoinRoom}
            >
              Join Chat
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md flex flex-col h-[calc(100vh-150px)]">
            <div className="flex justify-between items-center text-gray-700 mb-4 shrink-0">
              <span>
                Room: {roomCode} |{" "}
                {roomType === "group" ? "Group Chat" : "Two-User Chat"}
              </span>
              <button
                className="bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600 transition"
                onClick={handleDisconnect}
              >
                Disconnect
              </button>
            </div>
            <div
              ref={chatboxRef}
              className="overflow-y-auto mb-4 bg-gray-50 p-2 rounded-lg md:h-[400px] h-[calc(100vh-300px)]"
            >
              {messages.map((msg, index) => {
                const isSystemMessage = msg.sender === "System";
                const showNickname =
                  !isSystemMessage &&
                  (index === 0 || messages[index - 1].sender !== msg.sender);
                const isOwnMessage =
                  !isSystemMessage && msg.sender === nickname;

                return (
                  <div
                    key={index}
                    className={`flex ${
                      isSystemMessage
                        ? "justify-center"
                        : isOwnMessage
                        ? "justify-end"
                        : "justify-start"
                    } mb-2`}
                  >
                    {isSystemMessage ? (
                      <div className="flex items-center w-full">
                        <hr className="flex-grow border-gray-300" />
                        <span className="mx-2 text-sm text-gray-600 bg-gray-200 px-2 py-1 rounded">
                          {msg.text}
                        </span>
                        <hr className="flex-grow border-gray-300" />
                      </div>
                    ) : (
                      <div className="flex flex-col max-w-[70%]">
                        {showNickname && (
                          <div
                            className={`text-xs text-gray-600 mb-1 ${
                              isOwnMessage ? "text-right" : "text-left"
                            }`}
                          >
                            {msg.sender}
                          </div>
                        )}
                        <div className="flex items-end gap-1">
                          <div
                            className={`p-2 rounded-lg ${
                              isOwnMessage
                                ? "bg-indigo-100 text-indigo-900"
                                : "bg-gray-200 text-gray-900"
                            }`}
                          >
                            {msg.type === "text" ? (
                              <div className="whitespace-pre-wrap">
                                {msg.content}
                              </div>
                            ) : (
                              <img
                                src={msg.content}
                                alt="Shared image"
                                className="max-w-[200px] rounded-lg"
                              />
                            )}
                          </div>
                          <span className="text-xs text-gray-500 self-end mb-1">
                            {msg.timestamp}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 shrink-0">
              <div className="relative flex-grow">
                <textarea
                  ref={textareaRef}
                  className="flex-grow p-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none overflow-hidden min-h-[45px] max-h-[95px] w-full"
                  placeholder="Type your Message"
                  value={message}
                  onInput={handleTextareaChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-indigo-600 transition-colors"
                  onClick={() => fileInputRef.current.click()}
                >
                  <FaImage size={20} />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/jpeg,image/png,image/gif"
                  onChange={handleImageUpload}
                />
              </div>
              <button
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition self-end"
                onClick={handleSendMessage}
              >
                Send
              </button>
            </div>
            <div className="text-sm text-gray-500 mt-2 shrink-0">
              {securityStatus}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
