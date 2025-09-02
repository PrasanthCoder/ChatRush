// Updated app.jsx
// Changes:
// 1. Added [userId, setUserId] = useState(null); [sessionToken, setSessionToken] = useState(null);
// 2. In "roomCreated" and "roomJoined": setUserId(data.userId), setSessionToken(data.sessionToken)
// 3. In "roomJoined": existingUsers now have userId, use userId for setOtherUserId, newNicknames.set(user.userId, user.nickname)
// 4. In "newUser": use userId for setOtherUserId, setUserNicknames.set(userId, nickname), sharePublicKey use userId
// 5. In "userJoined": use userId for message
// 6. In "receivedPublicKey": use userId for setOtherUserId if needed
// 7. In "userLeft": use userId for comparison and remove
// 8. In "newEncryptedMessage" and "newEncryptedImage": expect senderUserId, use userNicknames.get(senderUserId)
// 9. In handleCreateRoom, handleCreateGroupRoom, handleJoinRoom: no change
// 10. In handleDisconnect: added setUserId(null), setSessionToken(null)
// 11. Added socket.on("connect", () => { if (page === "chat" && roomCode && sessionToken && userId) export publicKey, emit "rejoinRoom" { roomCode, sessionToken, publicKey } })
// 12. Added socket.on("roomRejoined", (...): set states, update userNicknames with userId, for two-user set otherUserId etc, share publicKey if two-user
// 13. Added socket.on("invalidRejoin", () => alert, handleDisconnect())
// 14. Added socket.on("userReconnected", ({ userId, nickname, publicKey }) => update for two-user or group
// 15. Added socket.on("reshareSymmetricKey", ({ userId, publicKey, roomCode }) => if isCreator, import publicKey, export symmetric, encrypt with RSA, emit shareEncryptedSymmetricKey
// 16. In "sharePublicKey" emit, use userId (target)
// 17. In dependencies, add userId, sessionToken where needed

import { useState, useEffect, useRef, useCallback } from "react";
import io from "socket.io-client";
import { FaImage } from "react-icons/fa";
import { formatTimestamp } from "./utils/formatConvertions.js";
import * as encryption from "./utils/encryption.js";
import { useChatActions } from "./hooks/useChatActions";

const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 2500,
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
  const [renderKey, setRenderKey] = useState(0);
  const [userId, setUserId] = useState(null); // Added: Persistent user ID
  const [sessionToken, setSessionToken] = useState(null); // Added: Session token for rejoin
  const chatboxRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const { handleSendMessage, handleImageUpload } = useChatActions(
    socket,
    setMessages,
    message,
    setMessage,
    roomCode,
    roomType,
    otherUserPublicKey,
    symmetricKey,
    nickname,
    formatTimestamp,
    textareaRef
  );

  const handleCreateRoom = async () => {
    console.log("handleCreateRoom triggered", !!myKeyPair);
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
    console.log("handleCreateGroupRoom triggered", !!myKeyPair);
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
    console.log("handleJoinRoom triggered", !!myKeyPair);
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

  const handleDisconnect = useCallback(async () => {
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
    setUserId(null);
    setSessionToken(null);
    setPage("home");
    setRenderKey((prev) => prev + 1);

    // Reconnect socket for future use
    socket.connect();
  }, [nickname, roomCode]);

  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);

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

  useEffect(() => {
    if (chatboxRef.current) {
      chatboxRef.current.scrollTop = chatboxRef.current.scrollHeight;
    }
  }, [messages]);

  const handleTextareaChange = (e) => {
    const textarea = e.target;
    setMessage(textarea.value);
    textarea.style.height = "5px";
    textarea.style.height = textarea.scrollHeight + "px";
  };

  useEffect(() => {
    socket.on("connect", async () => {
      console.log("Connected to server");
      if (page === "chat" && roomCode && sessionToken && userId && myKeyPair) {
        try {
          const publicKey = await encryption.exportPublicKey(
            myKeyPair.publicKey
          );
          socket.emit("rejoinRoom", { roomCode, sessionToken, publicKey });
        } catch (err) {
          console.error("Failed to export public key for rejoin:", err);
        }
      }
    });

    socket.on(
      "roomCreated",
      async ({ roomCode, nickname, roomType, userId, sessionToken }) => {
        console.log("roomCreated triggered", roomType, !!myKeyPair);
        setRoomCode(roomCode);
        setRoomType(roomType);
        setIsCreator(true);
        setUserId(userId);
        setSessionToken(sessionToken);
        if (roomType === "group") {
          setUserNicknames(new Map([[userId, nickname]]));
          setSecurityStatus(`Encryption: Secured (Symmetric, 0 peer(s))`);
        }
        setPage("chat");
        alert(
          `Share this code to join ${
            roomType === "group" ? "group" : "two-user"
          } chat: ${roomCode}`
        );
      }
    );

    socket.on(
      "roomJoined",
      async ({
        roomCode,
        nickname,
        roomType,
        existingUsers,
        userId,
        sessionToken,
      }) => {
        console.log(
          "roomJoined triggered",
          roomType,
          nickname,
          !!myKeyPair,
          existingUsers
        );
        setRoomType(roomType);
        setIsCreator(false);
        setUserId(userId);
        setSessionToken(sessionToken);
        if (roomType === "two-user") {
          const other = existingUsers[0] || {};
          setOtherUserNickname(other.nickname || "Unknown");
          setOtherUserId(other.userId || null);
          if (myKeyPair && other.userId) {
            try {
              const publicKey = await encryption.exportPublicKey(
                myKeyPair.publicKey
              );
              socket.emit("sharePublicKey", {
                userId: other.userId,
                publicKey,
                roomCode,
              });
            } catch (err) {
              console.error("Failed to share public key in roomJoined:", err);
            }
          }
        } else {
          const newNicknames = new Map([[userId, nickname]]);
          existingUsers.forEach((user) =>
            newNicknames.set(user.userId, user.nickname)
          );
          setUserNicknames(newNicknames);
          setSecurityStatus(
            `Encryption: Secured (Symmetric, ${newNicknames.size - 1} peer(s))`
          );
        }
        setPage("chat");
        setMessages((prev) => [
          ...prev,
          {
            sender: "System",
            text: "You joined the chat.",
            timestamp: formatTimestamp(),
          },
        ]);
      }
    );

    socket.on(
      "roomRejoined",
      async ({ roomCode, nickname, roomType, existingUsers }) => {
        console.log(
          "roomRejoined triggered",
          roomType,
          nickname,
          existingUsers
        );
        setRoomCode(roomCode);
        setRoomType(roomType);
        setNickname(nickname);
        if (roomType === "two-user") {
          const other = existingUsers[0] || {};
          setOtherUserId(other.userId);
          setOtherUserNickname(other.nickname);
          if (other.publicKey) {
            setOtherUserPublicKey(
              await encryption.importPublicKey(other.publicKey)
            );
            setSecurityStatus("Encryption: Secured (end-to-end encrypted)");
          }
          if (myKeyPair && other.userId) {
            const myPublicKey = await encryption.exportPublicKey(
              myKeyPair.publicKey
            );
            socket.emit("sharePublicKey", {
              userId: other.userId,
              publicKey: myPublicKey,
              roomCode,
            });
          }
        } else {
          const newNicknames = new Map([[userId, nickname]]);
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

    socket.on("invalidRejoin", () => {
      alert("Unable to rejoin the room. Please join again.");
      handleDisconnect();
    });

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
      console.log("newUser triggered", roomType, !!myKeyPair, userId);
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
              roomCode,
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
            roomCode,
          });
        }
        setSecurityStatus(
          `Encryption: Secured (Symmetric, ${userNicknames.size} peer(s))`
        );
      }
      const messageText = `${nickname} joined the chat.`;
      setMessages((prev) => [
        ...prev,
        { sender: "System", text: messageText, timestamp: formatTimestamp() },
      ]);
    });

    socket.on("receivedPublicKey", async ({ userId, publicKey, roomType }) => {
      console.log("receivedPublicKey triggered", roomType, userId);
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
      } catch (err) {
        console.error("Failed to process symmetric key:", err);
      }
    });

    socket.on(
      "reshareSymmetricKey",
      async ({ userId, publicKey, roomCode }) => {
        if (isCreator && symmetricKey) {
          try {
            const importedPublicKey = await encryption.importPublicKey(
              publicKey
            );
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
              roomCode,
            });
          } catch (err) {
            console.error("Failed to reshare symmetric key:", err);
          }
        }
      }
    );

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
      }
    });

    socket.on("userReconnected", async ({ userId, nickname, publicKey }) => {
      if (roomType === "two-user" && userId === otherUserId) {
        setOtherUserNickname(nickname);
        try {
          setOtherUserPublicKey(await encryption.importPublicKey(publicKey));
        } catch (err) {
          console.error("Failed to import reconnected public key:", err);
        }
      } else if (roomType === "group") {
        setUserNicknames((prev) => new Map(prev).set(userId, nickname));
        setSecurityStatus(
          `Encryption: Secured (Symmetric, ${userNicknames.size - 1} peer(s))`
        );
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
      async ({ senderUserId, encryptedMessage, roomType }) => {
        if (senderUserId !== userId) {
          let decrypted;
          if (roomType === "two-user") {
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
                sender: userNicknames.get(senderUserId) || "Unknown",
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
      async ({ senderUserId, encryptedImage, roomType }) => {
        if (senderUserId !== userId) {
          let decrypted;
          if (roomType === "two-user") {
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
                sender: userNicknames.get(senderUserId) || "Unknown",
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
      socket.off("connect");
      socket.off("roomCreated");
      socket.off("roomJoined");
      socket.off("roomRejoined");
      socket.off("invalidRejoin");
      socket.off("invalidRoom");
      socket.off("invalidNickname");
      socket.off("roomFull");
      socket.off("nicknameTaken");
      socket.off("newUser");
      socket.off("userJoined");
      socket.off("receivedPublicKey");
      socket.off("receiveSymmetricKey");
      socket.off("reshareSymmetricKey");
      socket.off("newCreator");
      socket.off("userReconnected");
      socket.off("userLeft");
      socket.off("newEncryptedMessage");
      socket.off("newEncryptedImage");
    };
  }, [
    roomType,
    myKeyPair,
    symmetricKey,
    isCreator,
    otherUserId,
    otherUserNickname,
    userNicknames,
    roomCode,
    sessionToken,
    userId,
    page,
    handleDisconnect,
  ]);

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
