import { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import { FaImage } from "react-icons/fa"; // Import FaImage from react-icons

const socket = io({
  autoConnect: false,
  reconnection: true, // Enable reconnection
  reconnectionAttempts: Infinity, // Keep trying to reconnect
  reconnectionDelay: 1000, // Start with 1 second delay
  reconnectionDelayMax: 5000, // Max delay of 5 seconds
}); // Replace with your local IP, disable autoConnect

function App() {
  const [page, setPage] = useState("home");
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [roomType, setRoomType] = useState(null);
  const [myKeyPair, setMyKeyPair] = useState(null);
  const [myNickname, setMyNickname] = useState(null);
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

  // Connect socket on mount
  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);

  // Generate key pair on mount
  useEffect(() => {
    async function initializeKeys() {
      console.log("Initializing key pair");
      const keyPair = await generateKeyPair();
      if (keyPair) {
        setMyKeyPair(keyPair);
        setSecurityStatus("Encryption: Ready (waiting for peer)");
      } else {
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

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type (only images)
    const validImageTypes = ["image/jpeg", "image/png", "image/gif"];
    if (!validImageTypes.includes(file.type)) {
      alert("Please upload a valid image file (JPEG, PNG, or GIF).");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Image = event.target.result; // Base64 string of the image
      await sendImageMessage(base64Image);
    };
    reader.readAsDataURL(file);

    // Reset file input
    e.target.value = null;
  };

  // Send image message (encrypt and emit)
  const sendImageMessage = async (base64Image) => {
    if (!currentRoom) return;

    if (roomType === "two-user" && otherUserPublicKey) {
      const aesKey = await generateSymmetricKey();
      const { encrypted, iv } = await encryptMessageAES(base64Image, aesKey);
      const exportedAesKey = await exportSymmetricKey(aesKey);
      const encryptedKey = await encryptMessageRSA(
        exportedAesKey,
        otherUserPublicKey
      );
      socket.emit("sendEncryptedImage", {
        roomCode: currentRoom,
        encryptedImage: { encrypted, iv, encryptedKey },
        roomType,
      });
      setMessages((prev) => [
        ...prev,
        {
          sender: myNickname,
          type: "image",
          content: base64Image,
          timestamp: formatTimestamp(),
        },
      ]);
    } else if (roomType === "group" && symmetricKey) {
      const { encrypted, iv } = await encryptMessageAES(
        base64Image,
        symmetricKey
      );
      socket.emit("sendEncryptedImage", {
        roomCode: currentRoom,
        encryptedImage: { encrypted, iv },
        roomType,
      });
      setMessages((prev) => [
        ...prev,
        {
          sender: myNickname,
          type: "image",
          content: base64Image,
          timestamp: formatTimestamp(),
        },
      ]);
    } else {
      alert("Encryption not ready. Please wait for other users.");
    }
  };

  // Encryption functions
  async function generateKeyPair() {
    try {
      if (!window.crypto || !window.crypto.subtle) {
        throw new Error("Web Crypto API not supported in this browser.");
      }
      console.log(
        "Generating key pair, Protocol:",
        window.location.protocol,
        "Host:",
        window.location.host,
        "SecureContext:",
        window.isSecureContext
      );
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"]
      );
      console.log(
        "Key pair generated successfully:",
        !!keyPair.publicKey,
        !!keyPair.privateKey
      );
      return keyPair;
    } catch (err) {
      console.error("Key generation failed:", err.message);
      console.log("Browser info:", navigator.userAgent);
      console.log(
        "Protocol:",
        window.location.protocol,
        "Host:",
        window.location.host,
        "SecureContext:",
        window.isSecureContext
      );
      setSecurityStatus(
        "Encryption: Failed to set up keys. Use a local IP (e.g., 192.168.1.x) or enable HTTPS."
      );
      return null;
    }
  }

  async function exportPublicKey(publicKey) {
    console.log("Entering exportPublicKey");
    if (!publicKey) {
      console.error("Public key is null or undefined");
      throw new Error("Cannot export null public key");
    }
    const exported = await window.crypto.subtle.exportKey("spki", publicKey);
    console.log("Public key exported successfully");
    return arrayBufferToBase64(exported);
  }

  async function importPublicKey(base64Key) {
    const binaryKey = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      "spki",
      binaryKey,
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["encrypt"]
    );
  }

  async function generateSymmetricKey() {
    try {
      return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (err) {
      console.error("Symmetric key generation failed:", err);
      return null;
    }
  }

  async function exportSymmetricKey(key) {
    const exported = await window.crypto.subtle.exportKey("raw", key);
    return arrayBufferToBase64(exported);
  }

  async function importSymmetricKey(base64Key) {
    const binaryKey = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      "raw",
      binaryKey,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptMessageRSA(message, publicKey) {
    const encoded = new TextEncoder().encode(message);
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      encoded
    );
    return arrayBufferToBase64(encrypted);
  }

  async function encryptMessageAES(message, symmetricKey) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(message);
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      symmetricKey,
      encoded
    );
    const encryptedBase64 = arrayBufferToBase64(encrypted);
    return { encrypted: encryptedBase64, iv: arrayBufferToBase64(iv) };
  }

  async function decryptMessageRSA(encrypted, privateKey) {
    try {
      const data = base64ToArrayBuffer(encrypted);
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        privateKey,
        data
      );
      return new TextDecoder().decode(decrypted);
    } catch (err) {
      console.error("Decryption failed:", err);
      return "[Failed to decrypt message]";
    }
  }

  async function decryptMessageAES(encryptedBase64, ivBase64, symmetricKey) {
    try {
      const iv = base64ToArrayBuffer(ivBase64);
      const data = base64ToArrayBuffer(encryptedBase64);
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        symmetricKey,
        data
      );
      return new TextDecoder().decode(decrypted);
    } catch (err) {
      console.error("AES decryption failed:", err);
      return "[Failed to decrypt message]";
    }
  }

  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Format timestamp as HH:mm
  const formatTimestamp = () => {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
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
      setCurrentRoom(roomCode);
      setRoomType(type);
      setMyNickname(nickname);
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
        setCurrentRoom(roomCode);
        setRoomType(type);
        setMyNickname(nickname);
        setIsCreator(false);
        if (type === "two-user") {
          setOtherUserNickname(existingUsers[0]?.nickname || "Unknown");
          setOtherUserId(existingUsers[0]?.userId || null);
          if (myKeyPair) {
            try {
              const publicKey = await exportPublicKey(myKeyPair.publicKey);
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
            const myPublicKey = await exportPublicKey(myKeyPair.publicKey);
            socket.emit("sharePublicKey", {
              userId,
              publicKey: myPublicKey,
              roomCode: currentRoom,
            });
          } catch (err) {
            console.error("Failed to share public key in newUser:", err);
          }
        }
      } else {
        setUserNicknames((prev) => new Map(prev).set(userId, nickname));
        if (isCreator && publicKey && symmetricKey) {
          const importedPublicKey = await importPublicKey(publicKey);
          const exportedSymmetricKey = await exportSymmetricKey(symmetricKey);
          const encryptedSymmetricKey = await encryptMessageRSA(
            exportedSymmetricKey,
            importedPublicKey
          );
          socket.emit("shareEncryptedSymmetricKey", {
            userId,
            encryptedSymmetricKey,
            roomCode: currentRoom,
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
          setOtherUserPublicKey(await importPublicKey(publicKey));
          setSecurityStatus("Encryption: Secured (end-to-end encrypted)");
        } catch (err) {
          console.error("Failed to process received public key:", err);
        }
      }
    });

    socket.on("receiveSymmetricKey", async ({ encryptedSymmetricKey }) => {
      try {
        const decryptedKey = await decryptMessageRSA(
          encryptedSymmetricKey,
          myKeyPair.privateKey
        );
        setSymmetricKey(await importSymmetricKey(decryptedKey));
        setSecurityStatus(
          `Encryption: Secured (Symmetric, ${userNicknames.size - 1} peer(s))`
        );
      } catch (err) {
        console.error("Failed to process symmetric key:", err);
      }
    });

    socket.on("newCreator", ({ roomCode }) => {
      if (roomCode === currentRoom && roomType === "group") {
        setIsCreator(true);
        setMessages((prev) => [
          ...prev,
          {
            sender: "System",
            text: "You are now the group chat creator.",
            timestamp: formatTimestamp(),
          },
        ]);
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
      async ({ senderId, encryptedMessage, roomType: type }) => {
        if (senderId !== socket.id) {
          let decrypted;
          if (type === "two-user") {
            const { encrypted, iv, encryptedKey } = encryptedMessage;
            const decryptedKey = await decryptMessageRSA(
              encryptedKey,
              myKeyPair.privateKey
            );
            const aesKey = await importSymmetricKey(decryptedKey);
            decrypted = await decryptMessageAES(encrypted, iv, aesKey);
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
            decrypted = await decryptMessageAES(encrypted, iv, symmetricKey);
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
            const decryptedKey = await decryptMessageRSA(
              encryptedKey,
              myKeyPair.privateKey
            );
            const aesKey = await importSymmetricKey(decryptedKey);
            decrypted = await decryptMessageAES(encrypted, iv, aesKey);
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
            decrypted = await decryptMessageAES(encrypted, iv, symmetricKey);
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
    currentRoom,
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
    const symKey = await generateSymmetricKey();
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
      const publicKey = await exportPublicKey(myKeyPair.publicKey);
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

  const handleSendMessage = async () => {
    if (!message || !currentRoom) return;
    if (roomType === "two-user" && otherUserPublicKey) {
      const aesKey = await generateSymmetricKey();
      const { encrypted, iv } = await encryptMessageAES(message, aesKey);
      const exportedAesKey = await exportSymmetricKey(aesKey);
      const encryptedKey = await encryptMessageRSA(
        exportedAesKey,
        otherUserPublicKey
      );
      socket.emit("sendEncryptedMessage", {
        roomCode: currentRoom,
        encryptedMessage: { encrypted, iv, encryptedKey },
        roomType,
      });
      setMessages((prev) => [
        ...prev,
        {
          sender: myNickname,
          type: "text",
          content: message,
          timestamp: formatTimestamp(),
        },
      ]);
      setMessage("");
      // Reset textarea height to minimum (matches min-h-[45px])
      if (textareaRef.current) {
        textareaRef.current.style.height = "45px";
      }
    } else if (roomType === "group" && symmetricKey) {
      const { encrypted, iv } = await encryptMessageAES(message, symmetricKey);
      socket.emit("sendEncryptedMessage", {
        roomCode: currentRoom,
        encryptedMessage: { encrypted, iv },
        roomType,
      });
      setMessages((prev) => [
        ...prev,
        {
          sender: myNickname,
          type: "text",
          content: message,
          timestamp: formatTimestamp(),
        },
      ]);
      setMessage("");
      // Reset textarea height to minimum (matches min-h-[45px])
      if (textareaRef.current) {
        textareaRef.current.style.height = "45px";
      }
    } else {
      alert("Encryption not ready. Please wait for other users.");
    }
  };

  const handleDisconnect = async () => {
    console.log("Disconnecting from room:", currentRoom);
    if (currentRoom) {
      socket.emit("leaveRoom", { roomCode: currentRoom, nickname: myNickname });
      socket.disconnect();
    }

    // Reset state
    setCurrentRoom(null);
    setRoomType(null);
    setMyNickname(null);
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
                Room: {currentRoom} |{" "}
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
                  !isSystemMessage && msg.sender === myNickname;

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
