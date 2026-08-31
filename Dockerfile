FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S wms && adduser -S wms -G wms
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY prisma ./prisma
COPY scripts ./scripts
COPY docs ./docs
USER wms
EXPOSE 3000
CMD ["node", "src/server.js"]
