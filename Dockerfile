# Stage 1: build the React frontend.
# Runs on your laptop's native CPU; the output is plain HTML/JS, so it works on any target.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: the runtime image (built for the target CPU, e.g. ARM for a CX9240)
FROM node:22-alpine
WORKDIR /app/server
ENV NODE_ENV=production \
    WEB_DIR=/app/web/dist
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
CMD ["node_modules/.bin/tsx", "src/server.ts"]
