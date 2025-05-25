const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const rooms = new Map(); // Store room data: { roomCode: { users: [{ userId, nickname, publicKey }], type: 'two-user' | 'group', creatorId: userId } }

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("createRoom", ({ nickname }) => {
    const roomCode = generateRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }
    rooms.set(roomCode, {
      users: [{ userId: socket.id, nickname }],
      type: "two-user",
      creatorId: socket.id,
    });
    socket.join(roomCode);
    socket.emit("roomCreated", { roomCode, nickname, roomType: "two-user" });
    console.log(`Room created: ${roomCode} by ${nickname} (two-user)`);
  });

  socket.on("createGroupRoom", ({ nickname }) => {
    const roomCode = generateRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }
    rooms.set(roomCode, {
      users: [{ userId: socket.id, nickname }],
      type: "group",
      creatorId: socket.id,
    });
    socket.join(roomCode);
    socket.emit("roomCreated", { roomCode, nickname, roomType: "group" });
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

    room.users.push({ userId: socket.id, nickname, publicKey });
    socket.join(roomCode);

    socket.emit("roomJoined", {
      roomCode,
      nickname,
      roomType: room.type,
      existingUsers: room.users.filter((user) => user.userId !== socket.id),
    });

    io.to(roomCode).emit("userJoined", { userId: socket.id, nickname });

    const newUserData = {
      userId: socket.id,
      nickname,
      publicKey,
      roomType: room.type,
    };
    socket.to(roomCode).emit("newUser", newUserData);

    console.log(`${nickname} joined room: ${roomCode} (${room.type})`);
  });

  socket.on("sharePublicKey", ({ userId, publicKey, roomCode }) => {
    const room = rooms.get(roomCode);
    if (room) {
      io.to(userId).emit("receivedPublicKey", {
        userId: socket.id,
        publicKey,
        roomType: room.type,
      });
    }
  });

  socket.on(
    "shareEncryptedSymmetricKey",
    ({ userId, encryptedSymmetricKey, roomCode }) => {
      io.to(userId).emit("receiveSymmetricKey", { encryptedSymmetricKey });
    }
  );

  socket.on(
    "sendEncryptedMessage",
    ({ roomCode, encryptedMessage, roomType }) => {
      socket.to(roomCode).emit("newEncryptedMessage", {
        senderId: socket.id,
        encryptedMessage,
        roomType,
      });
    }
  );

  socket.on("sendEncryptedImage", ({ roomCode, encryptedImage, roomType }) => {
    socket.to(roomCode).emit("newEncryptedImage", {
      senderId: socket.id,
      encryptedImage,
      roomType,
    });
  });

  socket.on("leaveRoom", ({ roomCode, nickname }) => {
    const room = rooms.get(roomCode);
    if (room) {
      room.users = room.users.filter((user) => user.userId !== socket.id);
      socket.to(roomCode).emit("userLeft", { userId: socket.id, nickname });

      if (room.users.length === 0) {
        rooms.delete(roomCode);
        console.log(`Room ${roomCode} deleted (no users left)`);
      } else if (room.creatorId === socket.id && room.type === "group") {
        const newCreator = room.users[0];
        room.creatorId = newCreator.userId;
        io.to(newCreator.userId).emit("newCreator", { roomCode });
        console.log(`New creator for room ${roomCode}: ${newCreator.nickname}`);
      }

      socket.leave(roomCode);
      console.log(`${nickname} left room: ${roomCode}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const [roomCode, room] of rooms.entries()) {
      const user = room.users.find((u) => u.userId === socket.id);
      if (user) {
        room.users = room.users.filter((u) => u.userId !== socket.id);
        socket.to(roomCode).emit("userLeft", {
          userId: socket.id,
          nickname: user.nickname,
        });

        if (room.users.length === 0) {
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted (no users left)`);
        } else if (room.creatorId === socket.id && room.type === "group") {
          const newCreator = room.users[0];
          room.creatorId = newCreator.userId;
          io.to(newCreator.userId).emit("newCreator", { roomCode });
          console.log(
            `New creator for room ${roomCode}: ${newCreator.nickname}`
          );
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
