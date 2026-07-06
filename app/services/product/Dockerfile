FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && rm -f package-lock.json
COPY --from=builder /app/dist ./dist
COPY tracing.js ./
EXPOSE 4001
CMD ["node", "--require", "./tracing.js", "dist/index.js"]
