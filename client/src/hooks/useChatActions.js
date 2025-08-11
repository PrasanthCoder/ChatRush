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
        socket.emit("sendEncryptedImage", {
          roomCode: roomCode,
          encryptedImage: { encrypted, iv, encryptedKey },
          roomType,
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
        socket.emit("sendEncryptedImage", {
          roomCode: roomCode,
          encryptedImage: { encrypted, iv },
          roomType,
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
      socket,
      setMessages,
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
