// hooks/useChatActions.js
import { useCallback } from "react"; // No useState for 'message' here
import * as encryption from "../utils/encryption";

export const useChatActions = (
  socket,
  setMessages, // Passed from App.js
  message, // Passed from App.js
  setMessage, // Passed from App.js
  roomCode,
  roomType,
  otherUserPublicKey,
  symmetricKey,
  nickname,
  formatTimestamp,
  textareaRef
) => {
  // Chunk size for image splitting
  const CHUNK_SIZE = 64 * 1024;
  // Helper function to reset textarea height
  const resetTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "45px"; // Reset height to minimum
    }
  }, [textareaRef]);

  // Function to send a text message
  const handleSendMessage = useCallback(async () => {
    if (!message || !roomCode) return;
    if (roomType === "two-user" && otherUserPublicKey) {
      const aesKey = await encryption.generateSymmetricKey();
      const { encrypted, iv } = await encryption.encryptMessageAES(
        message,
        aesKey
      );
      const exportedAesKey = await encryption.exportSymmetricKey(aesKey);
      const encryptedKey = await encryption.encryptMessageRSA(
        exportedAesKey,
        otherUserPublicKey
      );
      socket.emit("sendEncryptedMessage", {
        roomCode: roomCode,
        encryptedMessage: { encrypted, iv, encryptedKey },
        roomType,
      });
      setMessages((prev) => [
        ...prev,
        {
          sender: nickname,
          type: "text",
          content: message,
          timestamp: formatTimestamp(),
        },
      ]);
      setMessage(""); // Reset the message state in App.js
      resetTextareaHeight();
    } else if (roomType === "group" && symmetricKey) {
      const { encrypted, iv } = await encryption.encryptMessageAES(
        message,
        symmetricKey
      );
      socket.emit("sendEncryptedMessage", {
        roomCode: roomCode,
        encryptedMessage: { encrypted, iv },
        roomType,
      });
      setMessages((prev) => [
        ...prev,
        {
          sender: nickname,
          type: "text",
          content: message,
          timestamp: formatTimestamp(),
        },
      ]);
      setMessage(""); // Reset the message state in App.js
      resetTextareaHeight();
    } else {
      alert("Encryption not ready. Please wait for other users.");
    }
  }, [
    message,
    roomCode,
    roomType,
    otherUserPublicKey,
    symmetricKey,
    socket,
    setMessages,
    nickname,
    formatTimestamp,
    setMessage, // Include setMessage as a dependency
    resetTextareaHeight,
  ]);

  // Function to send an image message (extracted from the previous snippet)
  const sendImageMessage = useCallback(
    async (base64Image) => {
      if (!roomCode) return;

      if (roomType === "two-user" && otherUserPublicKey) {
        const aesKey = await encryption.generateSymmetricKey();
        const { encrypted, iv } = await encryption.encryptMessageAES(
          base64Image,
          aesKey
        );
        const exportedAesKey = await encryption.exportSymmetricKey(aesKey);
        const encryptedKey = await encryption.encryptMessageRSA(
          exportedAesKey,
          otherUserPublicKey
        );

        // Chunk the encrypted data and send chunks
        const chunks = [];
        for (let i = 0; i < encrypted.length; i += CHUNK_SIZE) {
          chunks.push(encrypted.slice(i, i + CHUNK_SIZE));
        }
        chunks.forEach((chunk, index) => {
          socket.emit("sendEncryptedImageChunk", {
            roomCode: roomCode,
            chunk: { encrypted: chunk, iv, encryptedKey },
            chunkIndex: index,
            totalChunks: chunks.length,
            roomType,
          });
        });

        setMessages((prev) => [
          ...prev,
          {
            sender: nickname,
            type: "image",
            content: base64Image,
            timestamp: formatTimestamp(),
          },
        ]);
      } else if (roomType === "group" && symmetricKey) {
        const { encrypted, iv } = await encryption.encryptMessageAES(
          base64Image,
          symmetricKey
        );

        // Chunk the encrypted data and send chunks
        const chunks = [];
        for (let i = 0; i < encrypted.length; i += CHUNK_SIZE) {
          chunks.push(encrypted.slice(i, i + CHUNK_SIZE));
        }
        chunks.forEach((chunk, index) => {
          socket.emit("sendEncryptedImageChunk", {
            roomCode: roomCode,
            chunk: { encrypted: chunk, iv },
            chunkIndex: index,
            totalChunks: chunks.length,
            roomType,
          });
        });

        setMessages((prev) => [
          ...prev,
          {
            sender: nickname,
            type: "image",
            content: base64Image,
            timestamp: formatTimestamp(),
          },
        ]);
      } else {
        alert("Encryption not ready. Please wait for other users.");
      }
    },
    [
      roomCode,
      roomType,
      otherUserPublicKey,
      symmetricKey,
      setMessages,
      CHUNK_SIZE,
      socket,
      nickname,
      formatTimestamp,
    ]
  );

  // Handle image upload input
  const handleImageUpload = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      console.log("file type: ", file.type);
      if (!file) return;

      const validImageTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
      ];
      if (!validImageTypes.includes(file.type)) {
        alert("Only JPEG, JPG, PNG, and GIF image types are allowed.");
        return;
      }

      // Check for image size > 20MB
      if (file.size > 20 * 1024 * 1024) {
        alert("Image size exceeds 20MB. Please choose a smaller image.");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        sendImageMessage(reader.result);
      };
      reader.readAsDataURL(file);
    },
    [sendImageMessage]
  );

  return {
    handleSendMessage,
    handleImageUpload,
  };
};
