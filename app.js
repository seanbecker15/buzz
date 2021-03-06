const port = process.env.PORT || 8000;
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const Room = require('./features/room');
const User = require('./features/user');

server.listen(port, function () {
  console.log("Server running at port %s", port);
});

const rooms = {};

let userIdNextVal = 1;
let roomIdNextVal = 1;


io.on('connection', socket => {
  function emitRoomUpdate(room) {
    if (Boolean(room)) {
      console.log('informing room...', { room })
      io.to(room.roomId).emit('roomUpdate', {
        room: {
          roomId: room.roomId,
          ownerId: room.ownerId,
          name: room.name,
          users: room.users,
          timerSetting: room.timerSetting,
          activeDrinkingSeconds: room.activeDrinkingSeconds
        }
      });
    }
  }

  function emitUserUpdate(user) {
    if (Boolean(user)) {
      console.log('informing user...')
      socket.emit('userUpdate', { user });
    }
  }

  function connectToRoom(room, user) {
    if (
      Boolean(room) &&
      Boolean(user)
    ) {
      user.active = true;
      console.log('joining room', room.roomId);
      socket.join(room.roomId);
      emitRoomUpdate(room);
      emitUserUpdate(user);
    }
  }

  socket.on('changeRoom', function ({ roomId, userId }) {
    if (roomId) {
      socket.leave(roomId);
    }
    if (rooms[roomId] && rooms[roomId].users[userId]) {
      rooms[roomId].users[userId].active = false;
    }
    socket.emit('enterRoomDetails');
    socket.emit('enterUserDetails');
  });

  // attempt to reconnect
  socket.on('reconnect', function (client) {
    const { roomId, userId } = client;
    let isValid = true, room, user;
    if (!Boolean(roomId) || !Boolean(room = rooms[roomId])) {
      // room does not exist
      // have user enter room details
      console.log('asking for room name');
      socket.emit('enterRoomDetails');
      isValid = false;
    }
    if (!Boolean(room) || !Boolean(userId) || !Boolean(user = room.users[parseInt(userId, 10)])) {
      // user info does not exist
      console.log('asking for user name', { room, userId, user });
      socket.emit('enterUserDetails');
      isValid = false;
    }
    if (isValid) {
      connectToRoom(room, user);
    }
  });

  socket.on('joinRoom', function (client) {
    const { userName, roomName } = client;
    if (!Boolean(userName) || !Boolean(roomName)) {
      console.error('invalid room join request...', { userName, roomName });
      socket.emit('enterRoomDetails');
      socket.emit('enterUserDetails');
      // invalid
      return;
    }
    // always create new user, do not assume names are unique
    const user = new User(userIdNextVal++, userName);
    console.log('created user', { user });

    // create room if it doesn't exist...
    let room = Object.values(rooms).find(r => r.name === roomName);
    if (room === undefined) {
      room = new Room(roomIdNextVal++, roomName, user); // adds user to room
      console.log('created room', { room });
      rooms[room.roomId] = room;
    } else {
      room.addUser(user);
    }
    socket.join(room.roomId);
    emitUserUpdate(user);
    emitRoomUpdate(room);
  })

  // socket.join('everyone');
  function buzz(userName, room) {
    io.to(room.roomId).emit('buzzing', { name: userName });
    room.buzzTimeoutId = setTimeout(() => {
      io.to(room.roomId).emit('clear');
      room.activeDrinkingSeconds += (room.timerSetting / 1000);
      console.log('active drinking seconds increased...', room.activeDrinkingSeconds);
      room.buzzTimeoutId = null;
      emitRoomUpdate(room);
    }, room.timerSetting);
  }
  socket.on('buzz', ({ userName, roomId }) => {
    let room;
    if (Boolean(userName) && Boolean(room = rooms[roomId])) {
      if (room.buzzTimeoutId) {
        const timeLeft = getTimeLeft(room.buzzTimeoutId);
        console.log('time remaining...', timeLeft);
        room.activeDrinkingSeconds += (room.timerSetting / 1000) - timeLeft;
        console.log('active drinking seconds increased...', room.activeDrinkingSeconds);
        clearTimeout(room.buzzTimeoutId);
        room.buzzTimeoutId = null;
      }
      buzz(userName, room);
    }

  });
});

function getTimeLeft(timeout) {
  return Math.ceil((timeout._idleStart + timeout._idleTimeout)/1000 - process.uptime())
}

app.use(express.static(__dirname + "/client"));
app.all("*", function (req, res) {
  res.sendFile(`${__dirname}/client/index.html`)
});

module.exports = app;
