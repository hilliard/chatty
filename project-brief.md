# Week 4: Build a Real-Time App

## What you're building

A multi-room live chat. People pick a nickname, join a room, and talk. Messages appear instantly for everyone in the room without a page refresh, and you can see who's online and who's typing.

In weeks 1 to 3, every update started with a click. Someone submitted a form, the server answered, the page changed. A chat app breaks that pattern: someone else sends a message, and it has to show up on your screen without you doing anything. That's real-time.

## Build it in this order

1. **Pick a nickname and enter the Lobby.** No passwords. Save the person with their nickname, remember them on this browser, and show the Lobby with its saved messages.
2. **Send a message live.** Open the Lobby in two windows. A message sent from one must appear in the other without a refresh.
3. **Add rooms.** Create rooms and switch between them. Each room shows only its own messages, both live and in the history.
4. **Add presence and typing.** Show who is online and who is typing. This is live state: it expires when people leave or stop typing.
5. **Test with two windows.** Keep two windows side by side and check refreshes, closed tabs, and a server restart.

Get this complete flow working before you add optional features.

## How real-time works on the web

Regular HTTP is request-response: the browser asks, the server answers, done. For real-time you need a way for the server to push data the moment something happens. There are four common options:

- **Polling.** The browser asks "anything new?" every few seconds. Simple and works everywhere, but wasteful and laggy for a chat.
- **Server-Sent Events (SSE).** The browser opens one long-lived HTTP connection and the server streams events down it. It only goes from server to browser, which is exactly what a chat feed needs: you send messages with a normal POST request and receive them through the stream.
- **WebSockets.** A full two-way channel. More powerful, and what you'd reach for in games or collaborative editors, but with more moving parts.
- **Hosted subscriptions.** Services like Supabase and Convex push database changes to your app for you. You write a query, and the results update live.

I used SSE for my version: POST to send, SSE to receive. It's the simplest architecture that delivers a real-time feel.

## Saved state and live state

**Saved state survives a restart.** Users, rooms, and messages go in the database. If the server restarts, the conversation must still be there.

**Live state only exists while people are connected.** Who is online and who is typing changes every few seconds. It can live in the server's memory, and nothing of value is lost if a restart clears it.

Keep the two apart. If "Alex is typing" ends up as a database row, something has to delete it later, and a crash can leave people showing as online hours after they left.

## Minimum requirements

Your chat app must have these features to be considered complete:

- [ ] **Nickname picker** before entering the chat (no passwords)
- [ ] **A default Lobby room**, plus the ability to create new rooms
- [ ] **Live messages** that appear instantly for everyone in the room, without a page refresh
- [ ] **Saved messages** that survive a refresh or a server restart
- [ ] **Older messages** that load when scrolling up
- [ ] **Online presence** showing who is currently in the room
- [ ] **Typing indicators** that clear a few seconds after someone stops typing
- [ ] **System messages** when someone joins or leaves a room
- [ ] **Automatic reconnect** after a dropped connection or a server restart
- [ ] **Mobile-friendly layout** with a room list view
- [ ] **Verify the complete flow** with two browser windows open side by side

## Additional features

Once the basics work, pick one of these:

- [ ] **@mentions** with autocomplete from the list of people online
- [ ] **@everyone** to mention everyone in the room at once
- [ ] **Notification bell** that lights up when someone mentions you in any room
- [ ] **Sound notifications** for new messages, with a mute toggle
- [ ] **Message grouping**, so consecutive messages from the same person show the name once
- [ ] **Rename** without leaving the chat
- [ ] **Avatar colors**, a random one for each person
- [ ] **Relative timestamps** like "2 min ago"
- [ ] **Room descriptions**
- [ ] **Grace period on disconnect**, so a page refresh does not post "left the room"
- [ ] **Catch up on missed messages** after a dropped connection
- [ ] **Deploy to a server** so people can join from other computers
- [ ] **Desktop app** with Electron or Tauri

## Topics

### When you actually need real-time

Not every app needs this. A dashboard you check twice a day is fine with page refreshes. Real-time is worth the extra work when data changes while you're looking at it and reacting quickly matters: chat, live scores, collaborative editing, monitoring. Knowing when not to use it is part of the skill.

### Broadcasting to a room

When one person sends a message, the server saves it and then sends it to every person connected to that room, and only that room. Ask your AI agent how it keeps track of which connections belong to which room.

### Disconnects and reconnects

People refresh pages, close laptops, and lose wifi. The browser has to reconnect on its own, and the server has to notice when someone is gone. A short grace period before posting "left the room" keeps a page refresh from spamming the chat.

### Hosting a live app

A live connection stays open for as long as someone is in the chat. Serverless functions (like Netlify or Vercel functions) are built for short requests, so they don't fit this project unless a hosted service handles the real-time part. Railway, Fly.io, Render, or a VPS run a server process that stays alive.

## Test with two windows

Open the chat in two browser profiles, or one normal window and one private window, and keep them side by side.

- [ ] Join with two different nicknames.
- [ ] Send a message from each window and confirm it appears in the other one instantly, without a refresh.
- [ ] Confirm both people see each other in the online list.
- [ ] Type in one window and confirm the other shows the typing indicator, then that it clears a few seconds after typing stops.
- [ ] Post in a second room and confirm those messages never show up in the Lobby.
- [ ] Refresh one window and confirm the history loads again and live messages keep arriving.
- [ ] Close one window and confirm the other one sees that person leave (after the grace period, if you added one).
- [ ] Restart the server and confirm both windows reconnect on their own and every message is still there.

Ask your AI agent to automate these flows after the manual version works.

## Recommended reading

Pick the resources that match what you need. You do not need to read everything before building.

### Learn the AI tools

- [The MCP servers I actually use, including Playwright for browser testing](https://flaviocopes.com/mcp-servers-i-use/)

### This week's concepts

- [Real-time Web Applications Course](https://flaviocopes.com/courses/real-time-web-applications/)
- [Server-Sent Events: streaming from server to browser](https://flaviocopes.com/server-sent-events/)
- [Introduction to WebSockets](https://flaviocopes.com/websockets/)
- [The Node.js Event Emitter](https://flaviocopes.com/node-event-emitter/)
- [Playwright Tutorial: end-to-end testing from scratch](https://flaviocopes.com/playwright-e2e-testing/)

### Total beginners

- [JavaScript Events Explained](https://flaviocopes.com/javascript-events/)
- [How to Use Promises in JavaScript](https://flaviocopes.com/javascript-promises/)
- [Node.js Course](https://flaviocopes.com/courses/nodejs/)

## Starter prompt

Copy this into your AI coding tool to get started:

```
Build me a multi-room live chat app. People pick a nickname and chat in real time across multiple rooms.

Identity:
- A join page where people pick a nickname (no passwords)
- Remember the person on this browser, so a refresh keeps them in the chat

Core features:
- A default "Lobby" room that always exists
- Create new rooms
- Messages appear instantly for everyone in the room, without refreshing the page
- Messages are saved in a database, so they survive a refresh or a server restart
- Scroll up to load older messages
- Show who is online in the room
- Typing indicators ("Alex is typing...") that clear a few seconds after typing stops
- System messages when someone joins or leaves
- Reconnect automatically if the connection drops
- Mobile-friendly layout with a room list view

Users, rooms, and messages are saved state and go in the database. Who is online and who is typing is live state: it only matters while people are connected, and it should expire when they leave or stop typing.

Start by telling me how the server will push updates to the browser (polling, Server-Sent Events, or WebSockets) and why. Server-Sent Events are a good default for a chat: send messages with a normal POST request, receive them through one open stream per room.

Make it feel like a real chat app, not a web form. Messages appear instantly, presence updates live, and the layout is clean and compact.
```

## Follow-up prompts

After you have a basic version working, use these to refine and add features:

**Test the live flow with two browsers:**
```
Add automated end-to-end tests for the real-time flow. Open two separate browser sessions with different nicknames in the same room. Verify that a message sent from one appears in the other without a refresh, that both people see each other in the online list, that typing in one shows the typing indicator in the other and it clears a few seconds after typing stops, that messages posted in another room never show up in this one, and that a refreshed page loads the history and keeps receiving live messages. Run the tests and fix any failures you find.
```

**Catch up after a dropped connection:**
```
Make the chat recover cleanly from connection drops (laptop sleep, wifi loss, server restart). When the live connection comes back, fetch every message sent while it was down and add it in order, without duplicating messages already on screen. Show a small "Reconnecting..." notice while the connection is down, and hide it once live updates resume.
```

**Add @mentions with autocomplete:**
```
Add @mentions to the chat. When I type @ followed by letters, show a dropdown of online users whose names match. I should be able to select with arrow keys and Tab/Enter. Also support @everyone to mention all users. Mentioned usernames should be highlighted in the message. When someone mentions me, show a notification.
```

**Add notification bell:**
```
Add a notification bell icon in the header. When someone @mentions me in any room, the bell should show an unread count. Clicking it opens a dropdown listing recent mentions with the sender, room name, and a preview. Add a "mark all read" button. Store notifications in the database so they persist.
```

**Add sound notifications:**
```
Add sound effects. Play a subtle notification sound when a new message arrives in the current room. Play a different, more prominent sound when someone @mentions me. Add a toggle button to mute/unmute sounds. Remember the preference in localStorage.
```

**Add message grouping:**
```
Group consecutive messages from the same user. Only show the username, avatar, and timestamp on the first message in a group. Subsequent messages from the same person should just show the message text, indented under the first one. Break the group when a different user sends a message or a system event occurs.
```

**Add rename functionality:**
```
Let users change their nickname without leaving the chat. Add a button that opens a modal where they can enter a new name. When they rename, broadcast a system message ("OldName changed their name to NewName") to all rooms they're in. Update the presence list for everyone.
```

**Add disconnect grace period:**
```
Don't show "left the room" immediately when someone disconnects. Wait 60 seconds. If they reconnect within that window (page refresh, brief network drop), cancel the leave message. This prevents spam during development and handles real-world connection blips.
```

**Deploy to Coolify*```
I want to deploy this chat app to Coolify people can use it from different computers. Set up the Coolify CLI first. Then create a PostgreSQL database on Coolify, migrate from SQLite if needed, make the server bind to 0.0.0.0 and read the PORT environment variable, and deploy. Open the deployed app in two browsers and confirm that messages, presence, and typing still update live through Coolify' proxy.
```

**Improve mobile layout:**
```
Make the mobile experience feel like a native chat app. On mobile, the sidebar should be a separate room list page, not a hidden panel. The back arrow should navigate to the room list. Disable pinch-to-zoom. Increase font sizes for touch readability. Remove non-essential UI elements on small screens to maximize chat space.
```

## The Stack

These are my choices for the chat app:

- Astro 7 in SSR mode with the Node adapter
- HTMX 4 with the SSE extension for live updates, and Alpine.js for small interactions
- AlpineJS
- PostgreSQL - Server-Sent Events for the real-time connection, broadcast inside the server with a Node.js EventEmitter
- Tailwind CSS v4
- Deployed on Coolify 

If you use another framework or a hosted real-time service, keep the same product flow and the same split between saved state and live state.
