// Updated index.js
// Changes:
// 1. Added const crypto = require("crypto");
// 2. In rooms user objects: added userId, sessionToken, disconnectTimeout: null
// 3. In createRoom and createGroupRoom: generate userId = crypto.randomUUID(), sessionToken = crypto.randomUUID(), add to user object.
// 4. In "roomCreated": added userId, sessionToken to emit.
// 5. In joinRoom: generate userId, sessionToken, add to user, in "roomJoined": added userId, sessionToken, and existingUsers with userId, nickname, publicKey.
// 6. In "newUser" and "userJoined": use userId instead of socket.id.
// 7. In sharePublicKey: find senderUserId and targetSocketId using room.users.find, emit with senderUserId (was userId: socket.id).
// 8. In shareEncryptedSymmetricKey: no change (uses userId which is now persistent).
// 9. In sendEncryptedMessage and sendEncryptedImage: find senderUserId = room.users.find(u => u.socketId === socket.id).userId, emit with senderUserId (renamed from senderId).
// 10. In sendEncryptedImageChunk: find senderUserId similarly, but since reassembled, emit newEncryptedImage with senderUserId.
// 11. In leaveRoom: find user by socket.id, clear disconnectTimeout if set, use user.userId for "userLeft".
// 12. In disconnect: find user by socket.id, if user and no disconnectTimeout, set user.disconnectTimeout = setTimeout(() => { remove by userId, emit "userLeft" with userId, handle room delete or new creator } , 30000)
// 13. Added socket.on("rejoinRoom", ...): find room, find user by sessionToken, if user and disconnectTimeout, clear timeout, update socketId, publicKey, join, emit "roomRejoined" with existingUsers including userId, nickname, publicKey.
//    Then socket.to(roomCode).emit("userReconnected", { userId, nickname, publicKey })
//    If group and not creator, find creator socketId, emit "reshareSymmetricKey" { userId, publicKey, roomCode }
// 14. Else emit "invalidRejoin"

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const crypto = require("crypto"); // Added: For generating UUIDs

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e7,
});

// Store room data:
// { roomCode: { users: [{ userId, socketId, sessionToken, nickname, publicKey, disconnectTimeout }], type: 'two-user' | 'group', creatorId: userId } }
const rooms = new Map();

const imageChunks = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("createRoom", ({ nickname }) => {
    const roomCode = generateRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }
    const userId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    rooms.set(roomCode, {
      users: [
        {
          userId,
          socketId: socket.id,
          sessionToken,
          nickname,
          disconnectTimeout: null,
        },
      ],
      type: "two-user",
      creatorId: userId,
    });
    socket.join(roomCode);
    socket.emit("roomCreated", {
      roomCode,
      nickname,
      roomType: "two-user",
      userId,
      sessionToken,
    });
    console.log(`Room created: ${roomCode} by ${nickname} (two-user)`);
  });

  socket.on("createGroupRoom", ({ nickname }) => {
    const roomCode = generateRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }
    const userId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    rooms.set(roomCode, {
      users: [
        {
          userId,
          socketId: socket.id,
          sessionToken,
          nickname,
          disconnectTimeout: null,
        },
      ],
      type: "group",
      creatorId: userId,
    });
    socket.join(roomCode);
    socket.emit("roomCreated", {
      roomCode,
      nickname,
      roomType: "group",
      userId,
      sessionToken,
    });
    console.log(`Group room created: ${roomCode} by ${nickname}`);
  });

  socket.on("joinRoom", ({ roomCode, nickname, publicKey }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("invalidRoom");
      return;
    }

    if (!nickname || nickname.trim() === "") {
      socket.emit("invalidNickname");
      return;
    }

    const nicknameExists = room.users.some(
      (user) => user.nickname === nickname
    );
    if (nicknameExists) {
      socket.emit("nicknameTaken");
      return;
    }

    if (room.type === "two-user" && room.users.length >= 2) {
      socket.emit("roomFull");
      return;
    }

    const userId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    room.users.push({
      userId,
      socketId: socket.id,
      sessionToken,
      nickname,
      publicKey,
      disconnectTimeout: null,
    });
    socket.join(roomCode);

    socket.emit("roomJoined", {
      roomCode,
      nickname,
      roomType: room.type,
      existingUsers: room.users
        .filter((user) => user.userId !== userId)
        .map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          publicKey: user.publicKey,
        })),
      userId,
      sessionToken,
    });

    io.to(roomCode).emit("userJoined", { userId, nickname });

    const newUserData = {
      userId,
      nickname,
      publicKey,
      roomType: room.type,
    };
    socket.to(roomCode).emit("newUser", newUserData);

    console.log(`${nickname} joined room: ${roomCode} (${room.type})`);
  });

  socket.on("rejoinRoom", ({ roomCode, sessionToken, publicKey }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("invalidRejoin");
      return;
    }

    const user = room.users.find((u) => u.sessionToken === sessionToken);
    if (user && user.disconnectTimeout) {
      clearTimeout(user.disconnectTimeout);
      user.disconnectTimeout = null;
      user.socketId = socket.id;
      user.publicKey = publicKey;
      socket.join(roomCode);
      socket.emit("roomRejoined", {
        roomCode,
        nickname: user.nickname,
        roomType: room.type,
        existingUsers: room.users
          .filter((u) => u.userId !== user.userId)
          .map((u) => ({
            userId: u.userId,
            nickname: u.nickname,
            publicKey: u.publicKey,
          })),
      });
      socket.to(roomCode).emit("userReconnected", {
        userId: user.userId,
        nickname: user.nickname,
        publicKey,
      });
      if (room.type === "group" && user.userId !== room.creatorId) {
        const creator = room.users.find((u) => u.userId === room.creatorId);
        if (creator && creator.socketId) {
          io.to(creator.socketId).emit("reshareSymmetricKey", {
            userId: user.userId,
            publicKey,
            roomCode,
          });
        }
      }
    } else {
      socket.emit("invalidRejoin");
    }
  });

  socket.on("sharePublicKey", ({ userId, publicKey, roomCode }) => {
    const room = rooms.get(roomCode);
    if (room) {
      const senderUserId = room.users.find(
        (u) => u.socketId === socket.id
      )?.userId;
      const targetSocketId = room.users.find(
        (u) => u.userId === userId
      )?.socketId;
      if (senderUserId && targetSocketId) {
        io.to(targetSocketId).emit("receivedPublicKey", {
          userId: senderUserId,
          publicKey,
          roomType: room.type,
        });
      }
    }
  });

  socket.on(
    "shareEncryptedSymmetricKey",
    ({ userId, encryptedSymmetricKey, roomCode }) => {
      const room = rooms.get(roomCode);
      io.to(room.users.find((u) => u.userId === userId)?.socketId).emit(
        "receiveSymmetricKey",
        { encryptedSymmetricKey }
      );
    }
  );

  socket.on(
    "sendEncryptedMessage",
    ({ roomCode, encryptedMessage, roomType }) => {
      const room = rooms.get(roomCode);
      if (room) {
        const senderUserId = room.users.find(
          (u) => u.socketId === socket.id
        )?.userId;
        if (senderUserId) {
          socket.to(roomCode).emit("newEncryptedMessage", {
            senderUserId,
            encryptedMessage,
            roomType,
          });
        }
      }
    }
  );

  // not getting used for now
  socket.on("sendEncryptedImage", ({ roomCode, encryptedImage, roomType }) => {
    const room = rooms.get(roomCode);
    if (room) {
      const senderUserId = room.users.find(
        (u) => u.socketId === socket.id
      )?.userId;
      if (senderUserId) {
        socket.to(roomCode).emit("newEncryptedImage", {
          senderUserId,
          encryptedImage,
          roomType,
        });
      }
    }
  });

  socket.on(
    "sendEncryptedImageChunk",
    ({ roomCode, chunk, chunkIndex, totalChunks, roomType }) => {
      const chunkKey = `${socket.id}:${roomCode}`;
      let chunkData = imageChunks.get(chunkKey) || {
        chunks: [],
        totalChunks,
        iv: chunk.iv,
        encryptedKey: chunk.encryptedKey,
      };

      chunkData.chunks[chunkIndex] = chunk.encrypted;

      imageChunks.set(chunkKey, chunkData);

      if (
        chunkData.chunks.length === totalChunks &&
        chunkData.chunks.every((c) => c !== undefined)
      ) {
        const reassembledImage = {
          encrypted: chunkData.chunks.join(""),
          iv: chunkData.iv,
          encryptedKey: chunkData.encryptedKey,
        };
        imageChunks.delete(chunkKey);

        const room = rooms.get(roomCode);
        if (room) {
          const senderUserId = room.users.find(
            (u) => u.socketId === socket.id
          )?.userId;
          if (senderUserId) {
            socket.to(roomCode).emit("newEncryptedImage", {
              senderUserId,
              encryptedImage: reassembledImage,
              roomType,
            });
          }
        }
      }
    }
  );

  socket.on("leaveRoom", ({ roomCode, nickname }) => {
    const room = rooms.get(roomCode);
    if (room) {
      const user = room.users.find((u) => u.socketId === socket.id);
      if (user) {
        if (user.disconnectTimeout) {
          clearTimeout(user.disconnectTimeout);
        }
        room.users = room.users.filter((u) => u.userId !== user.userId);
        socket.to(roomCode).emit("userLeft", { userId: user.userId, nickname });

        const chunkKey = `${socket.id}:${roomCode}`;
        if (imageChunks.has(chunkKey)) {
          imageChunks.delete(chunkKey);
        }

        if (room.users.length === 0) {
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted (no users left)`);
        } else if (room.creatorId === user.userId && room.type === "group") {
          const newCreator = room.users[0];
          room.creatorId = newCreator.userId;
          io.to(newCreator.socketId).emit("newCreator", { roomCode });
          console.log(
            `New creator for room ${roomCode}: ${newCreator.nickname}`
          );
        }

        socket.leave(roomCode);
        console.log(`${nickname} left room: ${roomCode}`);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const [roomCode, room] of rooms.entries()) {
      const user = room.users.find((u) => u.socketId === socket.id);
      if (user) {
        user.socketId = null; // Temporarily set to null
        if (!user.disconnectTimeout) {
          user.disconnectTimeout = setTimeout(() => {
            room.users = room.users.filter((u) => u.userId !== user.userId);
            socket.to(roomCode).emit("userLeft", {
              userId: user.userId,
              nickname: user.nickname,
            });

            const chunkKey = `${socket.id}:${roomCode}`;
            if (imageChunks.has(chunkKey)) {
              imageChunks.delete(chunkKey);
            }

            if (room.users.length === 0) {
              rooms.delete(roomCode);
              console.log(`Room ${roomCode} deleted (no users left)`);
            } else if (
              room.creatorId === user.userId &&
              room.type === "group"
            ) {
              const newCreator = room.users[0];
              room.creatorId = newCreator.userId;
              io.to(newCreator.socketId).emit("newCreator", { roomCode });
              console.log(
                `New creator for room ${roomCode}: ${newCreator.nickname}`
              );
            }
          }, 5000); // 5 seconds grace period
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
