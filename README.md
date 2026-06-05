# Scorched Earth AR

Prototype tabletop AR artillery game for pub tables.

## Local Run

```bash
cd backend
npm install
npm run dev
```

Open:

```text
http://localhost:3001/venue/demo/table/1
http://localhost:3001/admin
```

Phone AR testing needs HTTPS. Use Render/Netlify deployment or an HTTPS tunnel for local testing.

## Render Backend

Create a Render Web Service from this repository.

Settings:

```text
Root directory: backend
Runtime: Node
Build command: npm install
Start command: npm start
```

Environment variables:

```text
NODE_VERSION=20
CORS_ORIGIN=https://YOUR-NETLIFY-SITE.netlify.app
MONGO_URI=mongodb+srv://...
```

`MONGO_URI` is optional for the current prototype. If it is empty, live game state runs in memory only.

After Render deploys, note the backend URL:

```text
https://YOUR-RENDER-SERVICE.onrender.com
```

## Netlify Frontend

Create a Netlify site from this repository.

Settings:

```text
Base directory: frontend
Build command: npm run build
Publish directory: frontend
```

If Netlify asks for publish directory relative to the base directory, use:

```text
.
```

Environment variables:

```text
API_URL=https://YOUR-RENDER-SERVICE.onrender.com
```

The build writes `config.js`, and the browser uses that URL for REST and Socket.IO. `VITE_API_URL` and `SE_API_URL` are also accepted as aliases.

Test URL:

```text
https://YOUR-NETLIFY-SITE.netlify.app/venue/demo/table/1
```

Use this URL for the table QR code during prototype testing.

## Marker

Print:

```text
frontend/ar/markers/pattern-ARFly_binary_clean_05.png
```

The AR page uses:

```text
frontend/ar/markers/pattern-ARFly_binary_clean_05.patt
```
